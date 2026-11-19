use crate::protocol::Permissions;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    pub name: String,
    pub relay: bool,
    pub relay_url: String,
    pub receive_dir: PathBuf,
    pub host_on_launch: bool,
    pub listen_port: u16,
}

pub struct AppStore {
    root: PathBuf,
    pub settings: Settings,
    pub key: iroh::SecretKey,
    pub access: Arc<AccessPolicy>,
}

impl AppStore {
    pub fn open() -> Result<Self> {
        let (root, home) = application_paths()?;
        fs::create_dir_all(&root)?;
        let settings_path = root.join("settings.json");
        let settings = match fs::read(&settings_path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings {
                name: "My desktop".into(),
                relay: false,
                relay_url: String::new(),
                receive_dir: home.join("Downloads/Rust Remote Office"),
                host_on_launch: false,
                listen_port: 44124,
            },
            Err(error) => return Err(error.into()),
        };
        let key_path = root.join("identity.key");
        let key = match fs::read(&key_path) {
            Ok(bytes) => iroh::SecretKey::from_bytes(
                &bytes
                    .try_into()
                    .map_err(|_| anyhow::anyhow!("identity.key must contain 32 bytes"))?,
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let key = iroh::SecretKey::generate();
                let mut options = fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                options.open(&key_path)?.write_all(&key.to_bytes())?;
                key
            }
            Err(error) => return Err(error.into()),
        };
        let access = Arc::new(AccessPolicy::open(root.join("trusted.json"))?);
        Ok(Self {
            root,
            settings,
            key,
            access,
        })
    }

    pub fn save(&self) -> Result<()> {
        write_json(&self.root.join("settings.json"), &self.settings)
    }
}

fn application_paths() -> Result<(PathBuf, PathBuf)> {
    #[cfg(target_os = "windows")]
    {
        let home =
            PathBuf::from(std::env::var_os("USERPROFILE").context("USERPROFILE is missing")?);
        let root = PathBuf::from(std::env::var_os("APPDATA").context("APPDATA is missing")?)
            .join("RustRemoteOffice");
        Ok((root, home))
    }
    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var_os("HOME").context("HOME is missing")?);
        Ok((
            home.join("Library/Application Support/RustRemoteOffice"),
            home,
        ))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = PathBuf::from(std::env::var_os("HOME").context("HOME is missing")?);
        let root = match std::env::var_os("XDG_CONFIG_HOME") {
            Some(path) => PathBuf::from(path),
            None => home.join(".config"),
        }
        .join("rust-remote-office");
        Ok((root, home))
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.persist(path)?;
    Ok(())
}

pub struct AccessPolicy {
    path: Option<PathBuf>,
    trusted: Mutex<BTreeMap<String, Permissions>>,
    revoked: watch::Sender<BTreeSet<String>>,
}
impl Default for AccessPolicy {
    fn default() -> Self {
        let (revoked, _) = watch::channel(BTreeSet::new());
        Self {
            path: None,
            trusted: Mutex::new(BTreeMap::new()),
            revoked,
        }
    }
}
impl AccessPolicy {
    pub fn open(path: PathBuf) -> Result<Self> {
        let trusted = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path: Some(path),
            trusted: Mutex::new(trusted),
            ..Default::default()
        })
    }
    pub fn lookup(&self, peer: &str) -> Option<Permissions> {
        self.trusted.lock().unwrap().get(peer).copied()
    }
    pub fn trust(&self, peer: String, permissions: Permissions) -> Result<()> {
        let mut trusted = self.trusted.lock().unwrap();
        trusted.insert(peer.clone(), permissions);
        self.allow_session(&peer);
        write_json(
            self.path
                .as_ref()
                .context("Trust requires a configuration directory")?,
            &*trusted,
        )
    }
    pub fn forget(&self, peer: &str) -> Result<()> {
        let mut trusted = self.trusted.lock().unwrap();
        trusted.remove(peer);
        if let Some(path) = &self.path {
            write_json(path, &*trusted)?;
        }
        self.revoked.send_modify(|peers| {
            peers.insert(peer.to_owned());
        });
        Ok(())
    }
    pub fn changes(&self) -> watch::Receiver<BTreeSet<String>> {
        self.revoked.subscribe()
    }
    pub fn is_revoked(&self, peer: &str) -> bool {
        self.revoked.borrow().contains(peer)
    }
    pub fn allow_session(&self, peer: &str) {
        self.revoked.send_modify(|peers| {
            peers.remove(peer);
        });
    }
    pub fn trusted(&self) -> Vec<(String, Permissions)> {
        self.trusted
            .lock()
            .unwrap()
            .iter()
            .map(|(id, grant)| (id.clone(), *grant))
            .collect()
    }
}
