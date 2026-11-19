use crate::{
    capture::{
        BackendFactory, CaptureCommand, CaptureWorker, InputCommand, InputWorker, StopOnDrop,
    },
    config::AccessPolicy,
    files::{self, TransferEvent, TransferSink, TransferState, Upload},
    protocol::*,
    transport::{self, FrameAcks, FramePacer, NetworkSnapshot, ReceiveMetrics, StatsSampler},
};
use anyhow::{Context, Result, bail, ensure};
use iroh::{
    Endpoint, RelayUrl, SecretKey,
    endpoint::{Connection, ConnectionError, RelayMode, presets},
};
use std::{
    collections::BTreeMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct NetworkConfig {
    pub relay: bool,
    pub relay_url: Option<RelayUrl>,
    pub bind: Option<SocketAddr>,
    pub key: SecretKey,
    pub port: u16,
}
impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            relay: false,
            relay_url: None,
            bind: None,
            key: SecretKey::generate(),
            port: 0,
        }
    }
}

#[derive(Clone)]
pub struct HostOptions {
    pub network: NetworkConfig,
    pub monitor: usize,
    pub frame_interval: Duration,
    pub invite_ttl: Duration,
    pub frame_timeout: Duration,
    pub access: Arc<AccessPolicy>,
    pub receive_dir: PathBuf,
    pub attended: bool,
}
impl Default for HostOptions {
    fn default() -> Self {
        Self {
            network: NetworkConfig {
                port: 44124,
                ..Default::default()
            },
            monitor: 0,
            frame_interval: Duration::from_millis(125),
            invite_ttl: Duration::from_secs(600),
            frame_timeout: Duration::from_secs(60),
            access: Arc::new(AccessPolicy::default()),
            receive_dir: std::env::temp_dir().join("rust-remote-office-received"),
            attended: true,
        }
    }
}

#[derive(Clone)]
pub struct ViewerOptions {
    pub name: String,
    pub control: bool,
    pub files: bool,
    pub key: SecretKey,
    pub receive_dir: PathBuf,
    pub reconnect: bool,
}
impl Default for ViewerOptions {
    fn default() -> Self {
        Self {
            name: "My desktop".into(),
            control: true,
            files: true,
            key: SecretKey::generate(),
            receive_dir: std::env::temp_dir().join("rust-remote-office-received"),
            reconnect: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Approval {
    pub allow: bool,
    pub control: bool,
    pub files: bool,
    pub remember: bool,
}

pub enum HostEvent {
    Ready(String),
    Request {
        peer: String,
        name: String,
        control_requested: bool,
        files_requested: bool,
        answer: oneshot::Sender<Approval>,
    },
    Connected {
        peer: String,
        permissions: Permissions,
        connection: Connection,
    },
    Disconnected(String),
    Transfer(TransferEvent),
    Error(String),
    Stopped,
}

pub enum ViewerEvent {
    Identity(String),
    Connected {
        desktop: DesktopInfo,
        permissions: Permissions,
    },
    Clipboard(String),
    Notice(String),
    Path(String),
    Statistics(NetworkSnapshot),
    CaptureState(CaptureState),
    Transfer(TransferEvent),
    Reconnecting {
        attempt: u32,
        reason: String,
    },
    Finished(String),
}

pub struct RenderedFrame {
    pub screen: ScreenInfo,
    pub rgba: Vec<u8>,
}
pub struct ViewerChannels {
    pub commands: mpsc::Receiver<ClientMessage>,
    pub uploads: mpsc::Receiver<Upload>,
    pub frames: watch::Sender<Option<Arc<RenderedFrame>>>,
    pub events: mpsc::UnboundedSender<ViewerEvent>,
}

pub async fn endpoint(config: &NetworkConfig) -> Result<Endpoint> {
    let relay = match (config.relay, &config.relay_url) {
        (false, _) => RelayMode::Disabled,
        (true, Some(url)) => RelayMode::custom([url.clone()]),
        (true, None) => RelayMode::Default,
    };
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(config.key.clone())
        .transport_config(transport::quic_config())
        .relay_mode(relay)
        .alpns(vec![ALPN.to_vec()]);
    if let Some(address) = config.bind {
        builder = builder.clear_ip_transports().bind_addr(address)?;
    } else if config.port != 0 {
        builder = builder
            .clear_ip_transports()
            .bind_addr(format!("0.0.0.0:{}", config.port))?
            .bind_addr(format!("[::]:{}", config.port))?;
    }
    let endpoint = builder.bind().await?;
    if config.relay {
        tokio::time::timeout(Duration::from_secs(8), endpoint.online())
            .await
            .context("Relay did not become available")?;
    }
    Ok(endpoint)
}

struct HostState {
    options: HostOptions,
    factory: BackendFactory,
    events: mpsc::UnboundedSender<HostEvent>,
    token: [u8; 32],
    born: Instant,
    active: Arc<Semaphore>,
    active_connection: Mutex<Option<Connection>>,
    grants: Mutex<BTreeMap<String, Permissions>>,
}

struct ActiveSession<'a> {
    state: &'a HostState,
    _permit: tokio::sync::OwnedSemaphorePermit,
}
impl Drop for ActiveSession<'_> {
    fn drop(&mut self) {
        self.state.active_connection.lock().unwrap().take();
    }
}

pub async fn host(
    options: HostOptions,
    factory: BackendFactory,
    events: mpsc::UnboundedSender<HostEvent>,
    stop: CancellationToken,
) -> Result<()> {
    let endpoint = tokio::select! { _ = stop.cancelled() => return Ok(()), value = endpoint(&options.network) => value? };
    let result = async {
        let state = Arc::new(HostState { options, factory, events: events.clone(), token: rand::random(), born: Instant::now(),
            active: Arc::new(Semaphore::new(1)), active_connection: Mutex::new(None), grants: Mutex::new(BTreeMap::new()) });
        let invite = Invite { address: endpoint.addr(), token: state.token, relay: state.options.network.relay, relay_url: state.options.network.relay_url.clone() };
        events.send(HostEvent::Ready(invite.encode()?)).map_err(|_| anyhow::anyhow!("Window closed"))?;
        let mut sessions = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                _ = sessions.join_next(), if !sessions.is_empty() => {},
                incoming = endpoint.accept() => {
                    let Some(incoming) = incoming else { break; };
                    let state = state.clone();
                    let stop = stop.child_token();
                    sessions.spawn(async move {
                        let result = async {
                            let connection = tokio::select! { _ = stop.cancelled() => return Ok(()), value = incoming => value? };
                            let result = host_session(&connection, &state, stop).await;
                            connection.close(0u32.into(), b"Session ended");
                            result
                        }.await;
                        if let Err(error) = result { let _ = state.events.send(HostEvent::Disconnected(format!("{error:#}"))); }
                    });
                }
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), async { while sessions.join_next().await.is_some() {} }).await;
        sessions.abort_all();
        while sessions.join_next().await.is_some() {}
        Ok::<_, anyhow::Error>(())
    }.await;
    endpoint.close().await;
    let _ = events.send(HostEvent::Stopped);
    result
}

async fn host_session(
    connection: &Connection,
    state: &HostState,
    stop: CancellationToken,
) -> Result<()> {
    let (mut sender, mut receiver) = tokio::select! {
        _ = stop.cancelled() => bail!("Sharing stopped"),
        value = tokio::time::timeout(Duration::from_secs(5), connection.accept_bi()) => value??,
    };
    sender.set_priority(transport::CONTROL_PRIORITY)?;
    let hello: Hello = tokio::select! {
        _ = stop.cancelled() => bail!("Sharing stopped"),
        value = tokio::time::timeout(Duration::from_secs(5), read_message(&mut receiver, CONTROL_LIMIT)) => value??,
    };
    let peer = connection.remote_id().to_string();
    if state.options.access.is_revoked(&peer) {
        state.grants.lock().unwrap().remove(&peer);
    }
    let known = state
        .options
        .access
        .lookup(&peer)
        .or_else(|| state.grants.lock().unwrap().get(&peer).copied());
    if known.is_none()
        && let Err(error) = validate_hello(
            &hello,
            &state.token,
            state.born.elapsed() > state.options.invite_ttl,
        )
    {
        deny(&mut sender, error.to_string()).await?;
        bail!("Invite rejected");
    }
    let slot = match state.active.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => {
            let previous = state.active_connection.lock().unwrap().clone();
            if known.is_some()
                && let Some(previous) = previous
                && previous.remote_id() == connection.remote_id()
            {
                previous.close(
                    1u32.into(),
                    b"Replaced by another connection from this device",
                );
                tokio::select! {
                    _ = stop.cancelled() => bail!("Sharing stopped"),
                    value = tokio::time::timeout(Duration::from_secs(5), state.active.clone().acquire_owned()) => value??,
                }
            } else {
                deny(&mut sender, "Another session is active".into()).await?;
                bail!("Session busy");
            }
        }
    };
    *state.active_connection.lock().unwrap() = Some(connection.clone());
    let _active = ActiveSession {
        state,
        _permit: slot,
    };
    let permissions = match known {
        Some(permissions) => permissions,
        None => {
            if !state.options.attended {
                deny(
                    &mut sender,
                    "Pair this device in the desktop app first".into(),
                )
                .await?;
                bail!("Device is not trusted");
            }
            let (answer, approval) = oneshot::channel();
            state
                .events
                .send(HostEvent::Request {
                    peer: peer.clone(),
                    name: hello.name,
                    control_requested: hello.request_control,
                    files_requested: hello.request_files,
                    answer,
                })
                .map_err(|_| anyhow::anyhow!("Window closed"))?;
            let approval = tokio::select! {
                _ = stop.cancelled() => bail!("Sharing stopped"),
                _ = connection.closed() => bail!("The requesting device disconnected"),
                value = tokio::time::timeout(Duration::from_secs(60), approval) => value??,
            };
            if !approval.allow {
                deny(&mut sender, "The host declined the connection".into()).await?;
                bail!("Connection declined");
            }
            let permissions = Permissions {
                control: approval.control && hello.request_control,
                files: approval.files && hello.request_files,
            };
            if approval.remember {
                state.options.access.trust(peer.clone(), permissions)?;
            }
            state
                .grants
                .lock()
                .unwrap()
                .insert(peer.clone(), permissions);
            state.options.access.allow_session(&peer);
            permissions
        }
    };
    let permissions = Permissions {
        control: permissions.control && hello.request_control,
        files: permissions.files && hello.request_files,
    };
    let worker_stop = stop.child_token();
    let _guard = StopOnDrop(worker_stop.clone());
    let (ready_tx, ready_rx) = oneshot::channel();
    let (frame_tx, mut frame_rx) = mpsc::channel(1);
    let (capture_tx, capture_rx) = mpsc::channel(16);
    let (input_tx, input_rx) = mpsc::channel(128);
    let (reply_tx, mut reply_rx) = mpsc::unbounded_channel();
    let (file_tx, mut file_rx) = mpsc::channel(16);
    let pacing = Arc::new(FramePacer::new(state.options.frame_interval));
    let capture = CaptureWorker {
        factory: state.factory.clone(),
        monitor: state.options.monitor,
        pacing: pacing.clone(),
        ready: ready_tx,
        frames: frame_tx,
        commands: capture_rx,
        replies: reply_tx.clone(),
        stop: worker_stop.clone(),
    };
    let capture_worker = tokio::task::spawn_blocking(move || capture.run());
    let initialization = async {
        tokio::time::timeout(Duration::from_secs(30), ready_rx)
            .await
            .context("Display startup timed out")?
            .context("Capture worker stopped")?
            .map_err(anyhow::Error::msg)
    };
    let initialized = tokio::select! {
        _ = stop.cancelled() => bail!("Sharing stopped"),
        _ = connection.closed() => bail!("Connection closed during display startup"),
        value = initialization => value,
    };
    let ready = match initialized {
        Ok(ready) => ready,
        Err(error) => {
            deny(&mut sender, error.to_string()).await?;
            return Err(error);
        }
    };
    if state.options.access.is_revoked(&peer) {
        connection.close(1u32.into(), b"Device authorization revoked");
        bail!("Device authorization revoked");
    }
    let file_replies = reply_tx.clone();
    let input = InputWorker {
        factory: state.factory.clone(),
        commands: input_rx,
        replies: reply_tx,
        stop: worker_stop.clone(),
    };
    let input_worker = tokio::task::spawn_blocking(move || input.run());
    write_message(
        &mut sender,
        &HostMessage::Accepted {
            desktop: ready.desktop,
            permissions,
        },
        CONTROL_LIMIT,
    )
    .await?;
    let _ = state.events.send(HostEvent::Connected {
        peer: peer.clone(),
        permissions,
        connection: connection.clone(),
    });
    let (acks, mut ack_rx) = FrameAcks::new();
    let events = state.events.clone();
    let transfers: TransferSink = Arc::new(move |event| {
        if !event.incoming
            && let TransferState::Failed(message) = &event.state
        {
            let _ = file_replies.send(HostMessage::FileError {
                id: event.id,
                name: event.name.clone(),
                message: message.clone(),
            });
        }
        let _ = events.send(HostEvent::Transfer(event));
    });
    let mut changes = state.options.access.changes();
    let mut user_disconnect = false;
    let result = {
        let frames_out = async {
            let mut stream = connection.open_uni().await?;
            stream.set_priority(transport::SCREEN_PRIORITY)?;
            while let Some(frame) = frame_rx.recv().await {
                let started = Instant::now();
                acks.sending(frame.delta.sequence)?;
                tokio::time::timeout(state.options.frame_timeout, async {
                    write_message(&mut stream, &frame.delta, FRAME_LIMIT).await?;
                    ack_rx
                        .wait_for(|sequence| *sequence >= frame.delta.sequence)
                        .await?;
                    Ok::<_, anyhow::Error>(())
                })
                .await
                .context("Screen transfer timed out waiting for the receiver")??;
                pacing.delivered(started.elapsed());
                drop(frame.credit);
            }
            Ok::<_, anyhow::Error>(())
        };
        let commands_in = async {
            loop {
                let message: ClientMessage = read_message(&mut receiver, CONTROL_LIMIT).await?;
                message.validate()?;
                match message {
                    ClientMessage::FrameAck(sequence) => acks.acknowledge(sequence)?,
                    ClientMessage::Disconnect => {
                        user_disconnect = true;
                        return Ok::<_, anyhow::Error>(());
                    }
                    ClientMessage::Pause(value) => {
                        capture_tx.send(CaptureCommand::Pause(value)).await?;
                    }
                    ClientMessage::SelectDisplay(index) => {
                        capture_tx
                            .send(CaptureCommand::SelectDisplay(index))
                            .await?;
                    }
                    ClientMessage::SetUpdateRate(rate) => {
                        capture_tx.send(CaptureCommand::SetUpdateRate(rate)).await?;
                    }
                    ClientMessage::RequestFile { id, path } => {
                        ensure!(permissions.files, "File transfer is not allowed");
                        file_tx
                            .send(Upload {
                                id,
                                path: path.into(),
                            })
                            .await?;
                    }
                    ClientMessage::Input(event) => {
                        ensure!(permissions.control, "This session only allows viewing");
                        let screen = ready.screen.borrow().clone();
                        input_tx.send(InputCommand::Input { event, screen }).await?;
                    }
                    ClientMessage::SetClipboard(text) => {
                        ensure!(permissions.control, "This session only allows viewing");
                        input_tx.send(InputCommand::SetClipboard(text)).await?;
                    }
                    ClientMessage::GetClipboard => {
                        ensure!(permissions.control, "This session only allows viewing");
                        input_tx.send(InputCommand::GetClipboard).await?;
                    }
                }
            }
        };
        let replies_out = async {
            while let Some(message) = reply_rx.recv().await {
                tokio::time::timeout(
                    Duration::from_secs(5),
                    write_message(&mut sender, &message, CONTROL_LIMIT),
                )
                .await??;
            }
            Ok::<_, anyhow::Error>(())
        };
        let revoked = async {
            loop {
                if changes.borrow_and_update().contains(&peer) {
                    state.grants.lock().unwrap().remove(&peer);
                    connection.close(1u32.into(), b"Device authorization revoked");
                    bail!("Device authorization revoked");
                }
                changes.changed().await?;
            }
        };
        tokio::select! {
            value = frames_out => value,
            value = commands_in => value,
            value = replies_out => value,
            value = file_session(connection, &state.options.receive_dir, permissions.files, &mut file_rx, transfers) => value,
            value = revoked => value,
            _ = stop.cancelled() => { connection.close(1u32.into(), b"Sharing stopped"); Ok(()) },
        }
    };
    if user_disconnect
        || matches!(connection.close_reason(), Some(ConnectionError::ApplicationClosed(reason)) if reason.error_code == 1u32.into())
    {
        state.grants.lock().unwrap().remove(&peer);
    }
    connection.close(
        if stop.is_cancelled() { 1u32 } else { 0u32 }.into(),
        b"Session ended",
    );
    worker_stop.cancel();
    drop(input_tx);
    drop(capture_tx);
    input_worker.await??;
    capture_worker.await??;
    let _ = state
        .events
        .send(HostEvent::Disconnected("Session ended".into()));
    result
}

async fn deny(sender: &mut iroh::endpoint::SendStream, message: String) -> Result<()> {
    write_message(sender, &HostMessage::Denied(message), CONTROL_LIMIT).await?;
    sender.finish()?;
    let _ = tokio::time::timeout(Duration::from_secs(1), sender.stopped()).await;
    Ok(())
}

async fn file_session(
    connection: &Connection,
    directory: &std::path::Path,
    allowed: bool,
    uploads: &mut mpsc::Receiver<Upload>,
    events: TransferSink,
) -> Result<()> {
    let receive = async {
        loop {
            if let Err(error) = files::receive(connection, directory, allowed, &events).await
                && connection.close_reason().is_some()
            {
                return Err(error);
            }
        }
    };
    let send = async {
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                _ = tasks.join_next(), if !tasks.is_empty() => {},
                upload = uploads.recv() => {
                    let Some(upload) = upload else { return Ok::<_, anyhow::Error>(()); };
                    let connection = connection.clone();
                    let events = events.clone();
                    tasks.spawn(async move { let _ = files::send(&connection, upload, &events).await; });
                }
            }
        }
    };
    tokio::select! { result = receive => result, result = send => result }
}

#[derive(Debug)]
struct Denied(String);
impl std::fmt::Display for Denied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
impl std::error::Error for Denied {}
struct CloseOnDrop(Connection, CancellationToken);
impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        self.0.close(
            if self.1.is_cancelled() { 1u32 } else { 0u32 }.into(),
            b"Session ended",
        );
    }
}

pub async fn viewer(
    invite: Invite,
    options: ViewerOptions,
    mut channels: ViewerChannels,
    stop: CancellationToken,
) -> Result<()> {
    let config = NetworkConfig {
        relay: invite.relay,
        relay_url: invite.relay_url.clone(),
        key: options.key.clone(),
        ..Default::default()
    };
    let endpoint = tokio::select! { _ = stop.cancelled() => return Ok(()), value = endpoint(&config) => value? };
    let _ = channels
        .events
        .send(ViewerEvent::Identity(endpoint.id().to_string()));
    let mut result = Ok(());
    for attempt in 0..=5 {
        result = tokio::select! {
            _ = stop.cancelled() => Ok(()),
            value = viewer_on_endpoint(&endpoint, &invite, &options, &mut channels, stop.clone()) => value,
        };
        match &result {
            Ok(()) => break,
            Err(error) if error.is::<Denied>() || !options.reconnect || attempt == 5 => break,
            Err(error) => {
                while channels.commands.try_recv().is_ok() {}
                channels.frames.send_replace(None);
                let _ = channels.events.send(ViewerEvent::Reconnecting {
                    attempt: attempt + 1,
                    reason: error.to_string(),
                });
                tokio::select! {
                    _ = stop.cancelled() => { result = Ok(()); break; },
                    _ = tokio::time::sleep(Duration::from_secs((1u64 << attempt).min(8))) => {},
                }
            }
        }
    }
    endpoint.close().await;
    result
}

pub async fn viewer_on_endpoint(
    endpoint: &Endpoint,
    invite: &Invite,
    options: &ViewerOptions,
    channels: &mut ViewerChannels,
    stop: CancellationToken,
) -> Result<()> {
    let _ = channels
        .events
        .send(ViewerEvent::Identity(endpoint.id().to_string()));
    let connection = tokio::time::timeout(
        Duration::from_secs(25),
        endpoint.connect(invite.address.clone(), ALPN),
    )
    .await??;
    let _close = CloseOnDrop(connection.clone(), stop.clone());
    let result = async {
        let (mut sender, mut receiver) = connection.open_bi().await?;
        sender.set_priority(transport::CONTROL_PRIORITY)?;
        write_message(&mut sender, &Hello { token: invite.token, name: options.name.clone(), request_control: options.control, request_files: options.files }, CONTROL_LIMIT).await?;
        let permissions = match tokio::time::timeout(Duration::from_secs(95), read_message(&mut receiver, CONTROL_LIMIT)).await?? {
            HostMessage::Accepted { desktop, permissions } => { desktop.screen.byte_len()?; let _ = channels.events.send(ViewerEvent::Connected { desktop, permissions }); permissions }
            HostMessage::Denied(message) => return Err(Denied(message).into()),
            _ => bail!("Unexpected handshake response"),
        };
        let metrics = ReceiveMetrics::default();
        let (ack_tx, mut ack_rx) = mpsc::channel(2);
        let events = channels.events.clone();
        let transfers: TransferSink = Arc::new(move |event| { let _ = events.send(ViewerEvent::Transfer(event)); });
        let frames_in = async {
            let mut frames = connection.accept_uni().await?;
            let mut canvas = Canvas::default();
            loop {
                let (frame, bytes): (FrameDelta, _) = read_message_counted(&mut frames, FRAME_LIMIT).await?;
                let sequence = frame.sequence;
                let started = Instant::now();
                let (updated, image) = tokio::task::spawn_blocking(move || {
                    canvas.apply(frame)?;
                    let image = Arc::new(RenderedFrame { screen: canvas.screen.as_ref().unwrap().clone(), rgba: canvas.rgba.clone() });
                    Ok::<_, anyhow::Error>((canvas, image))
                }).await??;
                canvas = updated;
                channels.frames.send_replace(Some(image));
                metrics.received(bytes, started.elapsed());
                ack_tx.send(ClientMessage::FrameAck(sequence)).await?;
            }
            #[allow(unreachable_code)]
            Ok::<_, anyhow::Error>(())
        };
        let controls_in = async {
            loop {
                match read_message(&mut receiver, CONTROL_LIMIT).await? {
                    HostMessage::Clipboard(text) => { let _ = channels.events.send(ViewerEvent::Clipboard(text)); }
                    HostMessage::Notice(text) => { let _ = channels.events.send(ViewerEvent::Notice(text)); }
                    HostMessage::CaptureState(state) => { let _ = channels.events.send(ViewerEvent::CaptureState(state)); }
                    HostMessage::FileError { id, name, message } => {
                        let _ = channels.events.send(ViewerEvent::Transfer(TransferEvent { id, name, incoming: true, bytes: 0, total: 0, state: TransferState::Failed(message) }));
                    }
                    _ => bail!("Unexpected host message"),
                }
            }
        };
        let controls_out = async {
            let mut pending = None;
            loop {
                let application = async { match pending.take() { Some(message) => Some(message), None => channels.commands.recv().await } };
                let message = tokio::select! {
                    biased;
                    ack = ack_rx.recv() => ack,
                    message = application => message.map(|message| transport::coalesce_pointer(message, &mut channels.commands, &mut pending)),
                };
                let Some(message) = message else { return Ok::<_, anyhow::Error>(()); };
                message.validate()?;
                tokio::time::timeout(Duration::from_secs(5), write_message(&mut sender, &message, CONTROL_LIMIT)).await??;
            }
        };
        let statistics = async {
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            let mut sampler = StatsSampler::default();
            let mut sampled_at = Instant::now();
            loop {
                tick.tick().await;
                let selected = connection.paths().iter().find(|path| path.is_selected()).map(|path| (if path.is_ip() { "Direct P2P" } else { "Relay" }, path.stats().rtt));
                let _ = channels.events.send(ViewerEvent::Path(selected.map(|(name, _)| name).unwrap_or("Connecting").into()));
                let snapshot = sampler.sample(&metrics, sampled_at.elapsed(), selected.map(|(_, rtt)| rtt));
                sampled_at = Instant::now();
                let _ = channels.events.send(ViewerEvent::Statistics(snapshot));
            }
        };
        tokio::select! {
            result = frames_in => result,
            result = controls_in => result,
            result = controls_out => result,
            result = file_session(&connection, &options.receive_dir, permissions.files, &mut channels.uploads, transfers) => result,
            _ = statistics => Ok(()),
            _ = stop.cancelled() => Ok(()),
        }
    }.await;
    if let Some(ConnectionError::ApplicationClosed(reason)) = connection.close_reason()
        && reason.error_code == 1u32.into()
    {
        return Err(Denied(String::from_utf8_lossy(&reason.reason).into_owned()).into());
    }
    result
}
