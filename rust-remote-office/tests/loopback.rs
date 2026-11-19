use anyhow::Result;
use rust_remote_office::{
    capture::{BackendFactory, DesktopInput, RawScreen, ScreenCapture},
    protocol::*,
    session::*,
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

// Each case already runs two concurrent endpoints. Bound independent cases so shared
// hosts and CI do not start dozens of network watchers/runtimes simultaneously.
static NETWORK_TEST_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Default)]
struct Observed {
    captures: AtomicUsize,
    inputs: Mutex<Vec<InputEvent>>,
    clipboard: Mutex<String>,
    releases: AtomicUsize,
    released: tokio::sync::Notify,
    input_changed: tokio::sync::Notify,
    large_capture: AtomicBool,
    selected: AtomicUsize,
    slow_capture_ms: AtomicUsize,
    capture_started: tokio::sync::Notify,
    capture_finished: tokio::sync::Notify,
}

struct TestDesktop {
    observed: Arc<Observed>,
}
impl ScreenCapture for TestDesktop {
    fn capture(&mut self) -> Result<RawScreen> {
        let count = self.observed.captures.fetch_add(1, Ordering::SeqCst);
        let delay = self.observed.slow_capture_ms.load(Ordering::SeqCst);
        if count > 0 && delay > 0 {
            self.observed.capture_started.notify_one();
            std::thread::sleep(Duration::from_millis(delay as u64));
            self.observed.capture_finished.notify_one();
        }
        let large = self.observed.large_capture.load(Ordering::SeqCst);
        let info = ScreenInfo {
            name: format!(
                "Synthetic display {}",
                self.observed.selected.load(Ordering::SeqCst)
            ),
            platform: "test".into(),
            width: if large { 1024 } else { 130 },
            height: if large { 768 } else { 129 },
            input_x: -100 + self.observed.selected.load(Ordering::SeqCst) as i32 * 1000,
            input_y: 0,
            input_width: 65,
            input_height: 65,
        };
        let mut rgba = vec![255; info.byte_len()?];
        if large {
            let mut state = 0x9182_7364u32;
            for pixel in rgba.as_chunks_mut::<4>().0 {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                pixel[..3].copy_from_slice(&state.to_le_bytes()[..3]);
            }
        }
        rgba[0] = count as u8;
        Ok(RawScreen { info, rgba })
    }
    fn displays(&mut self) -> Result<Vec<DisplayInfo>> {
        Ok((0..2)
            .map(|index| DisplayInfo {
                index,
                name: format!("Synthetic display {index}"),
                width: 130,
                height: 129,
            })
            .collect())
    }
    fn select_display(&mut self, index: usize) -> Result<()> {
        anyhow::ensure!(index < 2, "Display does not exist");
        self.observed.selected.store(index, Ordering::SeqCst);
        Ok(())
    }
}
impl DesktopInput for TestDesktop {
    fn input(&mut self, event: InputEvent, _screen: &ScreenInfo) -> Result<()> {
        self.observed.inputs.lock().unwrap().push(event);
        self.observed.input_changed.notify_one();
        Ok(())
    }
    fn clipboard(&mut self) -> Result<String> {
        Ok(self.observed.clipboard.lock().unwrap().clone())
    }
    fn set_clipboard(&mut self, text: String) -> Result<()> {
        *self.observed.clipboard.lock().unwrap() = text;
        Ok(())
    }
    fn release_all(&mut self) {
        self.observed.releases.fetch_add(1, Ordering::SeqCst);
        self.observed.released.notify_one();
    }
}

struct Harness {
    _slot: tokio::sync::SemaphorePermit<'static>,
    invite: Invite,
    events: mpsc::UnboundedReceiver<HostEvent>,
    stop: CancellationToken,
    task: tokio::task::JoinHandle<Result<()>>,
    observed: Arc<Observed>,
}

impl Harness {
    async fn new() -> Self {
        Self::with_options(HostOptions::default()).await
    }

    async fn with_options(mut options: HostOptions) -> Self {
        let slot = NETWORK_TEST_SLOTS.acquire().await.unwrap();
        let observed = Arc::new(Observed::default());
        let capture_data = observed.clone();
        let input_data = observed.clone();
        let factory = BackendFactory {
            capture: Arc::new(move || {
                Ok(Box::new(TestDesktop {
                    observed: capture_data.clone(),
                }))
            }),
            input: Arc::new(move || {
                Ok(Box::new(TestDesktop {
                    observed: input_data.clone(),
                }))
            }),
        };
        let (events, mut receiver) = mpsc::unbounded_channel();
        let stop = CancellationToken::new();
        let task_stop = stop.clone();
        options
            .network
            .bind
            .get_or_insert("127.0.0.1:0".parse().unwrap());
        options.frame_interval = Duration::from_millis(25);
        let task = tokio::spawn(host(options, factory, events, task_stop));
        let ready = tokio::time::timeout(Duration::from_secs(10), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let HostEvent::Ready(invite) = ready else {
            panic!("Host did not become ready");
        };
        Self {
            _slot: slot,
            invite: Invite::decode(&invite).unwrap(),
            events: receiver,
            stop,
            task,
            observed,
        }
    }

    async fn approve(&mut self, approval: Approval) {
        let captures_before = self.observed.captures.load(Ordering::SeqCst);
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), self.events.recv())
                .await
                .unwrap()
                .unwrap();
            if let HostEvent::Request { answer, .. } = event {
                assert_eq!(
                    self.observed.captures.load(Ordering::SeqCst),
                    captures_before,
                    "No screen capture before consent"
                );
                answer.send(approval).unwrap();
                break;
            }
        }
    }

    async fn finish(mut self) {
        self.stop.cancel();
        tokio::time::timeout(Duration::from_secs(5), &mut self.task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.stop.cancel();
        self.task.abort();
    }
}

struct RawViewer {
    endpoint: iroh::Endpoint,
    connection: iroh::endpoint::Connection,
    sender: iroh::endpoint::SendStream,
    receiver: iroh::endpoint::RecvStream,
}

impl RawViewer {
    async fn new(invite: &Invite, send_hello: bool) -> Self {
        let endpoint = endpoint(&NetworkConfig {
            bind: Some("127.0.0.1:0".parse().unwrap()),
            ..Default::default()
        })
        .await
        .unwrap();
        let connection = tokio::time::timeout(
            Duration::from_secs(5),
            endpoint.connect(invite.address.clone(), ALPN),
        )
        .await
        .unwrap()
        .unwrap();
        let (sender, receiver) = connection.open_bi().await.unwrap();
        let mut viewer = Self {
            endpoint,
            connection,
            sender,
            receiver,
        };
        if send_hello {
            viewer.hello(invite).await;
        }
        viewer
    }

    async fn hello(&mut self, invite: &Invite) {
        write_message(
            &mut self.sender,
            &Hello {
                token: invite.token,
                name: "Slow test viewer".into(),
                request_control: true,
                request_files: true,
            },
            CONTROL_LIMIT,
        )
        .await
        .unwrap();
    }

    async fn accepted(&mut self) -> iroh::endpoint::RecvStream {
        let response: HostMessage = tokio::time::timeout(
            Duration::from_secs(5),
            read_message(&mut self.receiver, CONTROL_LIMIT),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(response, HostMessage::Accepted { .. }));
        tokio::time::timeout(Duration::from_secs(5), self.connection.accept_uni())
            .await
            .unwrap()
            .unwrap()
    }

    async fn close(self) {
        self.connection.close(0u32.into(), b"test completed");
        self.endpoint.close().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_receiver_stops_new_capture_but_control_and_clipboard_still_work() {
    let mut harness = Harness::new().await;
    let mut viewer = RawViewer::new(&harness.invite, true).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    let mut stream = viewer.accepted().await;
    let first: FrameDelta = read_message(&mut stream, FRAME_LIMIT).await.unwrap();
    let first_sequence = first.sequence;
    let mut canvas = Canvas::default();
    canvas.apply(first).unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 1);
    write_message(
        &mut viewer.sender,
        &ClientMessage::GetClipboard,
        CONTROL_LIMIT,
    )
    .await
    .unwrap();
    let reply: HostMessage = tokio::time::timeout(
        Duration::from_secs(2),
        read_message(&mut viewer.receiver, CONTROL_LIMIT),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(matches!(reply, HostMessage::Clipboard(_)));
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 1);
    write_message(
        &mut viewer.sender,
        &ClientMessage::FrameAck(first_sequence),
        CONTROL_LIMIT,
    )
    .await
    .unwrap();
    let second: FrameDelta = tokio::time::timeout(
        Duration::from_secs(2),
        read_message(&mut stream, FRAME_LIMIT),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(second.sequence, first_sequence + 1);
    canvas.apply(second).unwrap();
    assert_eq!(canvas.rgba[0], 1);
    viewer.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unread_large_screen_does_not_block_control_and_can_exceed_the_stream_window() {
    let mut harness = Harness::new().await;
    harness.observed.large_capture.store(true, Ordering::SeqCst);
    let mut viewer = RawViewer::new(&harness.invite, true).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    let mut stream = viewer.accepted().await;
    // Leave the image unread until the screen stream has had time to consume its credit.
    tokio::time::sleep(Duration::from_millis(150)).await;
    write_message(
        &mut viewer.sender,
        &ClientMessage::GetClipboard,
        CONTROL_LIMIT,
    )
    .await
    .unwrap();
    let reply: HostMessage = tokio::time::timeout(
        Duration::from_secs(3),
        read_message(&mut viewer.receiver, CONTROL_LIMIT),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(matches!(reply, HostMessage::Clipboard(_)));
    let (frame, bytes): (FrameDelta, usize) = tokio::time::timeout(
        Duration::from_secs(10),
        read_message_counted(&mut stream, FRAME_LIMIT),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        bytes > 2 * 1024 * 1024,
        "The test must exceed the configured per-stream receive window"
    );
    let mut canvas = Canvas::default();
    canvas.apply(frame).unwrap();
    assert_eq!(canvas.rgba.len(), 1024 * 768 * 4);
    assert!(
        canvas
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[3] == 255)
    );
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 1);
    viewer.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_receiver_that_never_confirms_a_frame_times_out_and_releases_the_backend() {
    let mut harness = Harness::with_options(HostOptions {
        frame_timeout: Duration::from_millis(300),
        ..Default::default()
    })
    .await;
    let mut viewer = RawViewer::new(&harness.invite, true).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    let mut stream = viewer.accepted().await;
    let _: FrameDelta = read_message(&mut stream, FRAME_LIMIT).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), viewer.connection.closed())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), harness.observed.released.notified())
        .await
        .unwrap();
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 1);
    viewer.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn future_frame_acknowledgements_are_rejected() {
    let mut harness = Harness::new().await;
    let mut viewer = RawViewer::new(&harness.invite, true).await;
    harness
        .approve(Approval {
            allow: true,
            control: false,
            files: true,
            remember: false,
        })
        .await;
    let mut stream = viewer.accepted().await;
    let first: FrameDelta = read_message(&mut stream, FRAME_LIMIT).await.unwrap();
    write_message(
        &mut viewer.sender,
        &ClientMessage::FrameAck(first.sequence + 1),
        CONTROL_LIMIT,
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), viewer.connection.closed())
        .await
        .unwrap();
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 1);
    viewer.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invite_expiration_is_checked_after_the_client_hello_arrives() {
    let mut harness = Harness::with_options(HostOptions {
        invite_ttl: Duration::from_secs(1),
        ..Default::default()
    })
    .await;
    let mut viewer = RawViewer::new(&harness.invite, false).await;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    viewer.hello(&harness.invite).await;
    let response: HostMessage = tokio::time::timeout(
        Duration::from_secs(3),
        read_message(&mut viewer.receiver, CONTROL_LIMIT),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(matches!(response, HostMessage::Denied(message) if message.contains("expired")));
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 0);
    while let Ok(event) = harness.events.try_recv() {
        assert!(!matches!(event, HostEvent::Request { .. }));
    }
    viewer.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopping_sharing_cancels_a_peer_that_has_not_sent_its_hello() {
    let harness = Harness::new().await;
    let viewer = RawViewer::new(&harness.invite, false).await;
    // Open an actual stream without completing the protocol handshake.
    let mut sender = viewer.sender;
    tokio::io::AsyncWriteExt::write_all(&mut sender, &[0])
        .await
        .unwrap();
    harness.stop.cancel();
    // Observe session closure, rather than timing QUIC's background draining period.
    tokio::time::timeout(Duration::from_secs(3), viewer.connection.closed())
        .await
        .unwrap();
    viewer.endpoint.close().await;
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_old_session_releases_input_before_a_reconnection_can_be_approved() {
    let mut harness = Harness::new().await;
    let mut first = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut first).await;
    first
        .commands
        .send(ClientMessage::Input(InputEvent::Key {
            key: KeyCode::Control,
            down: true,
        }))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        harness.observed.input_changed.notified(),
    )
    .await
    .unwrap();
    first.stop.cancel();
    tokio::time::timeout(Duration::from_secs(5), first.task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), harness.events.recv())
            .await
            .unwrap()
            .unwrap();
        if matches!(event, HostEvent::Disconnected(_)) {
            break;
        }
    }
    assert_eq!(harness.observed.releases.load(Ordering::SeqCst), 1);
    let mut second = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut second).await;
    second.stop.cancel();
    tokio::time::timeout(Duration::from_secs(5), second.task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_viewer_reports_measured_network_statistics() {
    let mut harness = Harness::new().await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: false,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    loop {
        let event = tokio::time::timeout(Duration::from_secs(3), client.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let ViewerEvent::Statistics(snapshot) = event
            && snapshot.received_frames > 0
        {
            assert!(snapshot.received_screen_bytes > 0);
            assert!(snapshot.screen_kib_per_second > 0.0);
            assert!(snapshot.updates_per_second > 0.0);
            assert!(snapshot.rtt_ms.is_some());
            break;
        }
    }
    client.stop.cancel();
    tokio::time::timeout(Duration::from_secs(5), client.task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    harness.finish().await;
}

struct Client {
    commands: mpsc::Sender<ClientMessage>,
    uploads: mpsc::Sender<rust_remote_office::files::Upload>,
    events: mpsc::UnboundedReceiver<ViewerEvent>,
    frames: watch::Receiver<Option<Arc<RenderedFrame>>>,
    stop: CancellationToken,
    task: tokio::task::JoinHandle<Result<()>>,
}

async fn connect(invite: Invite) -> Client {
    connect_options(
        invite,
        ViewerOptions {
            reconnect: false,
            ..Default::default()
        },
    )
    .await
}

async fn connect_options(invite: Invite, options: ViewerOptions) -> Client {
    let endpoint = endpoint(&NetworkConfig {
        key: options.key.clone(),
        bind: Some("127.0.0.1:0".parse().unwrap()),
        ..Default::default()
    })
    .await
    .unwrap();
    let (commands, command_rx) = mpsc::channel(128);
    let (uploads, upload_rx) = mpsc::channel(16);
    let (frames, frame_rx) = watch::channel(None);
    let (events, event_rx) = mpsc::unbounded_channel();
    let stop = CancellationToken::new();
    let worker_stop = stop.clone();
    let task = tokio::spawn(async move {
        let mut channels = ViewerChannels {
            commands: command_rx,
            uploads: upload_rx,
            frames,
            events,
        };
        let result =
            viewer_on_endpoint(&endpoint, &invite, &options, &mut channels, worker_stop).await;
        endpoint.close().await;
        result
    });
    Client {
        commands,
        uploads,
        events: event_rx,
        frames: frame_rx,
        stop,
        task,
    }
}

async fn frame(client: &mut Client) -> Arc<RenderedFrame> {
    loop {
        tokio::time::timeout(Duration::from_secs(10), client.frames.changed())
            .await
            .unwrap()
            .unwrap();
        if let Some(frame) = client.frames.borrow_and_update().clone() {
            return frame;
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn encrypted_loopback_streams_lossless_frames_input_and_clipboard_after_approval() {
    let mut harness = Harness::new().await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    let first = frame(&mut client).await;
    assert_eq!(first.rgba.len(), 130 * 129 * 4);
    assert!(first.rgba[1..].iter().all(|byte| *byte == 255));
    let second = frame(&mut client).await;
    assert_ne!(first.rgba[0], second.rgba[0]);
    assert_eq!(&first.rgba[1..], &second.rgba[1..]);
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Move { x: 0, y: u16::MAX }))
        .await
        .unwrap();
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Text(
            "跨平台办公 ✅".into(),
        )))
        .await
        .unwrap();
    client
        .commands
        .send(ClientMessage::SetClipboard("clipboard 数据".into()))
        .await
        .unwrap();
    client
        .commands
        .send(ClientMessage::GetClipboard)
        .await
        .unwrap();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(5), client.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let ViewerEvent::Clipboard(text) = event {
            assert_eq!(text, "clipboard 数据");
            break;
        }
    }
    assert_eq!(harness.observed.inputs.lock().unwrap().len(), 2);
    client.stop.cancel();
    tokio::time::timeout(Duration::from_secs(5), client.task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn denying_a_connection_never_opens_the_capture_backend() {
    let mut harness = Harness::new().await;
    let client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: false,
            control: false,
            files: true,
            remember: false,
        })
        .await;
    assert!(
        tokio::time::timeout(Duration::from_secs(5), client.task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 0);
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn view_only_cannot_inject_input_or_access_clipboard() {
    let mut harness = Harness::new().await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: false,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    client
        .commands
        .send(ClientMessage::SetClipboard("must not be applied".into()))
        .await
        .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(5), client.task)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_err());
    assert!(harness.observed.clipboard.lock().unwrap().is_empty());
    assert!(harness.observed.inputs.lock().unwrap().is_empty());
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_invite_is_rejected_without_a_consent_prompt() {
    let mut harness = Harness::new().await;
    let mut invite = harness.invite.clone();
    invite.token[0] ^= 1;
    let client = connect(invite).await;
    assert!(
        tokio::time::timeout(Duration::from_secs(5), client.task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    while let Ok(event) = harness.events.try_recv() {
        assert!(!matches!(event, HostEvent::Request { .. }));
    }
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), 0);
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopping_sharing_releases_input_and_closes_the_viewer_connection() {
    let mut harness = Harness::new().await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Key {
            key: KeyCode::Control,
            down: true,
        }))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(5),
        harness.observed.input_changed.notified(),
    )
    .await
    .unwrap();
    let observed = harness.observed.clone();
    harness.finish().await;
    tokio::time::timeout(Duration::from_secs(5), observed.released.notified())
        .await
        .unwrap();
    assert_eq!(observed.releases.load(Ordering::SeqCst), 1);
    assert!(
        tokio::time::timeout(Duration::from_secs(5), client.task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
}

async fn transfer(client: &mut Client, id: u64) -> rust_remote_office::files::TransferEvent {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ViewerEvent::Transfer(event)) = client.events.recv().await
                && event.id == id
                && !matches!(
                    event.state,
                    rust_remote_office::files::TransferState::Running
                )
            {
                return event;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn files_upload_download_and_reject_overwriting_existing_data() {
    use rust_remote_office::files::{TransferState, Upload};
    let temporary = tempfile::tempdir().unwrap();
    let host_dir = temporary.path().join("host");
    let viewer_dir = temporary.path().join("viewer");
    let source = temporary.path().join("办公文件.bin");
    let content: Vec<u8> = (0..1_000_000).map(|index| (index % 251) as u8).collect();
    std::fs::write(&source, &content).unwrap();
    let mut harness = Harness::with_options(HostOptions {
        receive_dir: host_dir.clone(),
        ..Default::default()
    })
    .await;
    let mut client = connect_options(
        harness.invite.clone(),
        ViewerOptions {
            receive_dir: viewer_dir.clone(),
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    client
        .uploads
        .send(Upload {
            id: 101,
            path: source.clone(),
        })
        .await
        .unwrap();
    assert!(matches!(
        transfer(&mut client, 101).await.state,
        TransferState::Complete(_)
    ));
    let remote = host_dir.join("办公文件.bin");
    assert_eq!(std::fs::read(&remote).unwrap(), content);
    client
        .commands
        .send(ClientMessage::RequestFile {
            id: 102,
            path: remote.display().to_string(),
        })
        .await
        .unwrap();
    assert!(matches!(
        transfer(&mut client, 102).await.state,
        TransferState::Complete(_)
    ));
    assert_eq!(
        std::fs::read(viewer_dir.join("办公文件.bin")).unwrap(),
        content
    );
    std::fs::write(&source, b"must not replace the existing file").unwrap();
    client
        .uploads
        .send(Upload {
            id: 103,
            path: source,
        })
        .await
        .unwrap();
    assert!(matches!(
        transfer(&mut client, 103).await.state,
        TransferState::Failed(_)
    ));
    assert_eq!(std::fs::read(&remote).unwrap(), content);
    client
        .commands
        .send(ClientMessage::RequestFile {
            id: 104,
            path: temporary.path().join("missing.txt").display().to_string(),
        })
        .await
        .unwrap();
    assert!(matches!(
        transfer(&mut client, 104).await.state,
        TransferState::Failed(_)
    ));
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_permission_is_independent_of_screen_viewing() {
    use rust_remote_office::files::{TransferState, Upload};
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source.txt");
    std::fs::write(&source, b"file permission test").unwrap();
    let host_dir = temporary.path().join("received");
    let mut harness = Harness::with_options(HostOptions {
        receive_dir: host_dir.clone(),
        ..Default::default()
    })
    .await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: false,
            files: false,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    client
        .uploads
        .send(Upload {
            id: 201,
            path: source,
        })
        .await
        .unwrap();
    assert!(matches!(
        transfer(&mut client, 201).await.state,
        TransferState::Failed(_)
    ));
    assert!(!host_dir.join("source.txt").exists());
    frame(&mut client).await;
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn trusted_device_connects_unattended_and_revocation_ends_the_session() {
    use rust_remote_office::config::AccessPolicy;
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("trusted.json");
    let key = iroh::SecretKey::generate();
    let peer = key.public().to_string();
    AccessPolicy::open(path.clone())
        .unwrap()
        .trust(
            peer.clone(),
            Permissions {
                control: true,
                files: true,
            },
        )
        .unwrap();
    let access = Arc::new(AccessPolicy::open(path.clone()).unwrap());
    let mut harness = Harness::with_options(HostOptions {
        access: access.clone(),
        attended: false,
        invite_ttl: Duration::ZERO,
        ..Default::default()
    })
    .await;
    let mut invite = harness.invite.clone();
    invite.token[0] ^= 1;
    let mut client = connect_options(
        invite,
        ViewerOptions {
            key,
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    frame(&mut client).await;
    while let Ok(event) = harness.events.try_recv() {
        assert!(!matches!(event, HostEvent::Request { .. }));
    }
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Text("无人值守".into())))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        harness.observed.input_changed.notified(),
    )
    .await
    .unwrap();
    access.forget(&peer).unwrap();
    access.forget("another-device").unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(5), client.task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert!(AccessPolicy::open(path).unwrap().lookup(&peer).is_none());
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn capture_can_pause_switch_displays_and_change_the_update_rate() {
    let mut harness = Harness::new().await;
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: false,
            files: false,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    client
        .commands
        .send(ClientMessage::Pause(true))
        .await
        .unwrap();
    loop {
        if let ViewerEvent::CaptureState(state) =
            tokio::time::timeout(Duration::from_secs(3), client.events.recv())
                .await
                .unwrap()
                .unwrap()
            && state.paused
        {
            break;
        }
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    let captured = harness.observed.captures.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(harness.observed.captures.load(Ordering::SeqCst), captured);
    client
        .commands
        .send(ClientMessage::SelectDisplay(1))
        .await
        .unwrap();
    client
        .commands
        .send(ClientMessage::SetUpdateRate(20))
        .await
        .unwrap();
    client
        .commands
        .send(ClientMessage::Pause(false))
        .await
        .unwrap();
    loop {
        if let ViewerEvent::CaptureState(state) =
            tokio::time::timeout(Duration::from_secs(3), client.events.recv())
                .await
                .unwrap()
                .unwrap()
            && !state.paused
            && state.display == 1
            && state.rate == 20
        {
            break;
        }
    }
    loop {
        if frame(&mut client).await.screen.name.ends_with('1') {
            break;
        }
    }
    assert_eq!(harness.observed.selected.load(Ordering::SeqCst), 1);
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_busy_capture_thread_does_not_block_input() {
    let mut harness = Harness::new().await;
    harness
        .observed
        .slow_capture_ms
        .store(1500, Ordering::SeqCst);
    let mut client = connect(harness.invite.clone()).await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: false,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    tokio::time::timeout(
        Duration::from_secs(3),
        harness.observed.capture_started.notified(),
    )
    .await
    .unwrap();
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Text(
            "input while capturing".into(),
        )))
        .await
        .unwrap();
    tokio::select! {
        biased;
        _ = harness.observed.capture_finished.notified() => panic!("Input waited for the capture thread"),
        _ = harness.observed.input_changed.notified() => {},
    }
    harness.observed.slow_capture_ms.store(0, Ordering::SeqCst);
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_interrupted_v1_session_reconnects_with_the_same_identity_without_a_new_prompt() {
    let mut harness = Harness::new().await;
    let (commands, command_rx) = mpsc::channel(128);
    let (uploads, upload_rx) = mpsc::channel(16);
    let (frames, frame_rx) = watch::channel(None);
    let (events, event_rx) = mpsc::unbounded_channel();
    let stop = CancellationToken::new();
    let task = tokio::spawn(viewer(
        harness.invite.clone(),
        ViewerOptions::default(),
        ViewerChannels {
            commands: command_rx,
            uploads: upload_rx,
            frames,
            events,
        },
        stop.clone(),
    ));
    let mut client = Client {
        commands,
        uploads,
        events: event_rx,
        frames: frame_rx,
        stop,
        task,
    };
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut client).await;
    let first_connection = loop {
        if let HostEvent::Connected { connection, .. } =
            tokio::time::timeout(Duration::from_secs(3), harness.events.recv())
                .await
                .unwrap()
                .unwrap()
        {
            break connection;
        }
    };
    let peer = first_connection.remote_id();
    first_connection.close(0u32.into(), b"simulate network interruption");
    tokio::time::timeout(Duration::from_secs(8), async {
        let mut reconnecting = false;
        loop {
            match client.events.recv().await.unwrap() {
                ViewerEvent::Reconnecting { .. } => reconnecting = true,
                ViewerEvent::Connected { .. } if reconnecting => break,
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    let second_connection = loop {
        match tokio::time::timeout(Duration::from_secs(3), harness.events.recv())
            .await
            .unwrap()
            .unwrap()
        {
            HostEvent::Request { .. } => {
                panic!("An already authorized V1 session requested consent again")
            }
            HostEvent::Connected { connection, .. } => break connection,
            _ => {}
        }
    };
    assert_eq!(second_connection.remote_id(), peer);
    frame(&mut client).await;
    client
        .commands
        .send(ClientMessage::Input(InputEvent::Text(
            "resumed input".into(),
        )))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        harness.observed.input_changed.notified(),
    )
    .await
    .unwrap();
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    harness.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remembered_access_survives_a_host_restart_with_the_same_v1_identity_and_port() {
    use rust_remote_office::config::AccessPolicy;
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("trusted.json");
    let host_key = iroh::SecretKey::generate();
    let viewer_key = iroh::SecretKey::generate();
    let access = Arc::new(AccessPolicy::open(path.clone()).unwrap());
    let mut first = Harness::with_options(HostOptions {
        access,
        network: NetworkConfig {
            key: host_key.clone(),
            ..Default::default()
        },
        ..Default::default()
    })
    .await;
    let old_invite = first.invite.clone();
    let address = *old_invite
        .address
        .ip_addrs()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let mut client = connect_options(
        old_invite.clone(),
        ViewerOptions {
            key: viewer_key.clone(),
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    first
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: true,
        })
        .await;
    frame(&mut client).await;
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    first.finish().await;
    let mut second = Harness::with_options(HostOptions {
        access: Arc::new(AccessPolicy::open(path).unwrap()),
        attended: false,
        invite_ttl: Duration::ZERO,
        network: NetworkConfig {
            key: host_key,
            bind: Some(address),
            ..Default::default()
        },
        ..Default::default()
    })
    .await;
    let mut client = connect_options(
        old_invite,
        ViewerOptions {
            key: viewer_key,
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    frame(&mut client).await;
    while let Ok(event) = second.events.try_recv() {
        assert!(!matches!(event, HostEvent::Request { .. }));
    }
    client.stop.cancel();
    client.task.await.unwrap().unwrap();
    second.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_same_authorized_device_can_replace_its_old_connection() {
    let mut harness = Harness::new().await;
    let key = iroh::SecretKey::generate();
    let mut first = connect_options(
        harness.invite.clone(),
        ViewerOptions {
            key: key.clone(),
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    harness
        .approve(Approval {
            allow: true,
            control: true,
            files: true,
            remember: false,
        })
        .await;
    frame(&mut first).await;
    let mut second = connect_options(
        harness.invite.clone(),
        ViewerOptions {
            key,
            reconnect: false,
            ..Default::default()
        },
    )
    .await;
    frame(&mut second).await;
    assert!(
        tokio::time::timeout(Duration::from_secs(5), first.task)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    while let Ok(event) = harness.events.try_recv() {
        assert!(!matches!(event, HostEvent::Request { .. }));
    }
    second
        .commands
        .send(ClientMessage::Input(InputEvent::Text(
            "new connection".into(),
        )))
        .await
        .unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        harness.observed.input_changed.notified(),
    )
    .await
    .unwrap();
    second.stop.cancel();
    second.task.await.unwrap().unwrap();
    harness.finish().await;
}
