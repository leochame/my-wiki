use crate::protocol::{CONTROL_LIMIT, read_message, write_message};
use anyhow::{Result, ensure};
use iroh::endpoint::Connection;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Debug)]
pub enum TransferState {
    Running,
    Complete(PathBuf),
    Failed(String),
}

#[derive(Clone, Debug)]
pub struct TransferEvent {
    pub id: u64,
    pub name: String,
    pub incoming: bool,
    pub bytes: u64,
    pub total: u64,
    pub state: TransferState,
}

pub type TransferSink = Arc<dyn Fn(TransferEvent) + Send + Sync>;

#[derive(Debug)]
pub struct Upload {
    pub id: u64,
    pub path: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct Header {
    id: u64,
    name: String,
    size: u64,
}
#[derive(Serialize, Deserialize)]
enum Reply {
    Ready,
    Complete,
    Rejected(String),
}

pub async fn send(connection: &Connection, upload: Upload, events: &TransferSink) -> Result<()> {
    let name = upload.path.display().to_string();
    let mut event = TransferEvent {
        id: upload.id,
        name,
        incoming: false,
        bytes: 0,
        total: 0,
        state: TransferState::Running,
    };
    let result = async {
        let metadata = tokio::fs::metadata(&upload.path).await?;
        ensure!(metadata.is_file(), "Select a regular file");
        let mut file = tokio::fs::File::open(&upload.path).await?;
        event.name = upload
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        event.total = metadata.len();
        events(event.clone());
        let (mut sender, mut receiver) = connection.open_bi().await?;
        sender.set_priority(-20)?;
        write_message(
            &mut sender,
            &Header {
                id: upload.id,
                name: event.name.clone(),
                size: event.total,
            },
            CONTROL_LIMIT,
        )
        .await?;
        match read_message(&mut receiver, CONTROL_LIMIT).await? {
            Reply::Ready => (),
            Reply::Rejected(reason) => anyhow::bail!("{reason}"),
            Reply::Complete => anyhow::bail!("Unexpected file reply"),
        }
        let mut hash = blake3::Hasher::new();
        let mut buffer = vec![0; 64 * 1024];
        let mut report = Instant::now();
        while event.bytes < event.total {
            let length = (event.total - event.bytes).min(buffer.len() as u64) as usize;
            file.read_exact(&mut buffer[..length]).await?;
            sender.write_all(&buffer[..length]).await?;
            hash.update(&buffer[..length]);
            event.bytes += length as u64;
            if report.elapsed() >= Duration::from_millis(100) {
                events(event.clone());
                report = Instant::now();
            }
        }
        sender.write_all(hash.finalize().as_bytes()).await?;
        sender.finish()?;
        match read_message(&mut receiver, CONTROL_LIMIT).await? {
            Reply::Complete => (),
            Reply::Rejected(reason) => anyhow::bail!("{reason}"),
            Reply::Ready => anyhow::bail!("Unexpected file reply"),
        }
        event.state = TransferState::Complete(upload.path.clone());
        Ok::<_, anyhow::Error>(())
    }
    .await;
    if let Err(error) = &result {
        event.state = TransferState::Failed(format!("{error:#}"));
    }
    events(event);
    result
}

pub async fn receive(
    connection: &Connection,
    directory: &Path,
    allowed: bool,
    events: &TransferSink,
) -> Result<()> {
    let (mut sender, mut receiver) = connection.accept_bi().await?;
    sender.set_priority(10)?;
    let header: Header = read_message(&mut receiver, CONTROL_LIMIT).await?;
    if !allowed {
        write_message(
            &mut sender,
            &Reply::Rejected("File transfer is not allowed".into()),
            CONTROL_LIMIT,
        )
        .await?;
        sender.finish()?;
        return Ok(());
    }
    ensure!(
        !header.name.is_empty()
            && !header.name.contains(['/', '\\'])
            && header.name != "."
            && header.name != "..",
        "Invalid file name"
    );
    let target = directory.join(&header.name);
    let mut event = TransferEvent {
        id: header.id,
        name: header.name,
        incoming: true,
        bytes: 0,
        total: header.size,
        state: TransferState::Running,
    };
    let result = async {
        tokio::fs::create_dir_all(directory).await?;
        ensure!(
            !target.exists(),
            "File already exists: {}",
            target.display()
        );
        let temporary = tempfile::NamedTempFile::new_in(directory)?;
        let mut file = tokio::fs::File::from_std(temporary.reopen()?);
        write_message(&mut sender, &Reply::Ready, CONTROL_LIMIT).await?;
        events(event.clone());
        let mut hash = blake3::Hasher::new();
        let mut buffer = vec![0; 64 * 1024];
        let mut report = Instant::now();
        while event.bytes < event.total {
            let length = (event.total - event.bytes).min(buffer.len() as u64) as usize;
            receiver.read_exact(&mut buffer[..length]).await?;
            file.write_all(&buffer[..length]).await?;
            hash.update(&buffer[..length]);
            event.bytes += length as u64;
            if report.elapsed() >= Duration::from_millis(100) {
                events(event.clone());
                report = Instant::now();
            }
        }
        let mut expected = [0; 32];
        receiver.read_exact(&mut expected).await?;
        ensure!(
            hash.finalize().as_bytes() == &expected,
            "File checksum mismatch"
        );
        file.flush().await?;
        drop(file);
        temporary.persist_noclobber(&target)?;
        write_message(&mut sender, &Reply::Complete, CONTROL_LIMIT).await?;
        sender.finish()?;
        event.state = TransferState::Complete(target);
        Ok::<_, anyhow::Error>(())
    }
    .await;
    if let Err(error) = &result {
        event.state = TransferState::Failed(format!("{error:#}"));
        let _ = write_message(
            &mut sender,
            &Reply::Rejected(error.to_string()),
            CONTROL_LIMIT,
        )
        .await;
        let _ = sender.finish();
    }
    events(event);
    result
}
