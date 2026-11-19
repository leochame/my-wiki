use crate::{
    capture::native,
    config::AppStore,
    files::{TransferEvent, TransferState, Upload},
    protocol::*,
    session::{
        self, Approval, HostEvent, HostOptions, NetworkConfig, RenderedFrame, ViewerChannels,
        ViewerEvent, ViewerOptions,
    },
    transport::NetworkSnapshot,
};
use anyhow::Result;
use eframe::egui::{self, Color32, Key, RichText, Vec2};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

pub fn run(store: AppStore) -> Result<()> {
    let runtime = tokio::runtime::Runtime::new()?;
    eframe::run_native(
        "Rust Remote Office V1",
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_inner_size([1280.0, 860.0])
                .with_min_inner_size([900.0, 650.0]),
            ..Default::default()
        },
        Box::new(move |context| {
            context.egui_ctx.set_visuals(egui::Visuals::dark());
            Ok(Box::new(OfficeApp::new(runtime, store)))
        }),
    )
    .map_err(|error| anyhow::anyhow!("{error}"))
}

struct Pending {
    peer: String,
    name: String,
    requested: bool,
    control: bool,
    files_requested: bool,
    files: bool,
    remember: bool,
    answer: oneshot::Sender<Approval>,
}
struct Sharing {
    stop: CancellationToken,
    events: mpsc::UnboundedReceiver<HostEvent>,
    emit: mpsc::UnboundedSender<HostEvent>,
    permissions: Permissions,
    invite: String,
    status: String,
    pending: Option<Pending>,
    connection: Option<iroh::endpoint::Connection>,
}
struct Viewing {
    stop: CancellationToken,
    commands: mpsc::Sender<ClientMessage>,
    uploads: mpsc::Sender<Upload>,
    events: mpsc::UnboundedReceiver<ViewerEvent>,
    frames: watch::Receiver<Option<Arc<RenderedFrame>>>,
    screen: Option<ScreenInfo>,
    displays: Vec<DisplayInfo>,
    control: bool,
    files: bool,
    identity: String,
    path: String,
    network: Option<NetworkSnapshot>,
    texture: Option<egui::TextureHandle>,
}
struct OfficeApp {
    runtime: tokio::runtime::Runtime,
    store: AppStore,
    name: String,
    relay: bool,
    relay_url: String,
    receive_dir: String,
    host_on_launch: bool,
    listen_port: u16,
    monitor: usize,
    monitors: Vec<DisplayInfo>,
    share: Option<Sharing>,
    view: Option<Viewing>,
    invite: String,
    request_control: bool,
    request_files: bool,
    reconnect: bool,
    map_shortcuts: bool,
    held: HashSet<KeyCode>,
    buttons: HashSet<PointerButton>,
    scroll: Vec2,
    status: String,
    paused: bool,
    pause_when_minimized: bool,
    paused_by_window: bool,
    selected_display: usize,
    update_rate: u32,
    zoom: f32,
    fullscreen: bool,
    files_open: bool,
    devices_open: bool,
    local_file: String,
    remote_file: String,
    transfers: BTreeMap<u64, TransferEvent>,
}
impl OfficeApp {
    fn new(runtime: tokio::runtime::Runtime, store: AppStore) -> Self {
        let settings = store.settings.clone();
        let auto_share = settings.host_on_launch;
        let mut app = Self {
            runtime,
            store,
            name: settings.name,
            relay: settings.relay,
            relay_url: settings.relay_url,
            receive_dir: settings.receive_dir.display().to_string(),
            host_on_launch: auto_share,
            listen_port: settings.listen_port,
            monitor: 0,
            monitors: Vec::new(),
            share: None,
            view: None,
            invite: String::new(),
            request_control: true,
            request_files: true,
            reconnect: true,
            map_shortcuts: true,
            held: HashSet::new(),
            buttons: HashSet::new(),
            scroll: Vec2::ZERO,
            status: "Ready".into(),
            paused: false,
            pause_when_minimized: true,
            paused_by_window: false,
            selected_display: 0,
            update_rate: 8,
            zoom: 0.0,
            fullscreen: false,
            files_open: false,
            devices_open: false,
            local_file: String::new(),
            remote_file: String::new(),
            transfers: BTreeMap::new(),
        };
        if auto_share && native::supported() {
            app.start_share();
        }
        app
    }
    fn save_settings(&mut self) -> Result<()> {
        self.store.settings = crate::config::Settings {
            name: self.name.clone(),
            relay: self.relay,
            relay_url: self.relay_url.clone(),
            receive_dir: self.receive_dir.clone().into(),
            host_on_launch: self.host_on_launch,
            listen_port: self.listen_port,
        };
        self.store.save()
    }
    fn start_share(&mut self) {
        let options = (|| {
            Ok::<_, anyhow::Error>(HostOptions {
                network: NetworkConfig {
                    relay: self.relay,
                    relay_url: if self.relay_url.trim().is_empty() {
                        None
                    } else {
                        Some(self.relay_url.trim().parse()?)
                    },
                    key: self.store.key.clone(),
                    port: self.listen_port,
                    ..Default::default()
                },
                monitor: self.monitor,
                access: self.store.access.clone(),
                receive_dir: self.receive_dir.clone().into(),
                ..Default::default()
            })
        })();
        let options = match options {
            Ok(options) => options,
            Err(error) => {
                self.status = error.to_string();
                return;
            }
        };
        let (events, receiver) = mpsc::unbounded_channel();
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let emit = events.clone();
        self.runtime.spawn(async move {
            let factory = native::factory(options.monitor);
            if let Err(error) = session::host(options, factory, events.clone(), worker_stop).await {
                let _ = events.send(HostEvent::Error(format!("{error:#}")));
            }
        });
        self.share = Some(Sharing {
            stop,
            events: receiver,
            emit,
            permissions: Permissions::default(),
            invite: String::new(),
            status: "Preparing connection...".into(),
            pending: None,
            connection: None,
        });
    }
    fn stop_share(&mut self) {
        if let Some(share) = self.share.take() {
            share.stop.cancel();
        }
    }
    fn connect(&mut self) -> Result<()> {
        let invite = Invite::decode(&self.invite)?;
        let options = ViewerOptions {
            name: self.name.clone(),
            control: self.request_control,
            files: self.request_files,
            key: self.store.key.clone(),
            receive_dir: self.receive_dir.clone().into(),
            reconnect: self.reconnect,
        };
        let (commands, command_rx) = mpsc::channel(128);
        let (uploads, upload_rx) = mpsc::channel(16);
        let (frames, frame_rx) = watch::channel(None);
        let (events, event_rx) = mpsc::unbounded_channel();
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        self.runtime.spawn(async move {
            let result = session::viewer(
                invite,
                options,
                ViewerChannels {
                    commands: command_rx,
                    uploads: upload_rx,
                    frames,
                    events: events.clone(),
                },
                worker_stop,
            )
            .await;
            let message = match result {
                Ok(()) => "Disconnected".into(),
                Err(error) => format!("{error:#}"),
            };
            let _ = events.send(ViewerEvent::Finished(message));
        });
        self.view = Some(Viewing {
            stop,
            commands,
            uploads,
            events: event_rx,
            frames: frame_rx,
            screen: None,
            displays: Vec::new(),
            control: false,
            files: false,
            identity: String::new(),
            path: "Connecting".into(),
            network: None,
            texture: None,
        });
        self.paused = false;
        self.status = "Connecting...".into();
        Ok(())
    }
    fn disconnect(&mut self) {
        if let Some(view) = self.view.take() {
            view.stop.cancel();
        }
        self.held.clear();
        self.buttons.clear();
    }
    fn poll(&mut self, ctx: &egui::Context) {
        if let Some(share) = &mut self.share {
            while let Ok(event) = share.events.try_recv() {
                match event {
                    HostEvent::Ready(invite) => {
                        share.invite = invite;
                        share.status = "Sharing. New invites expire after 10 minutes.".into();
                    }
                    HostEvent::Request {
                        peer,
                        name,
                        control_requested,
                        files_requested,
                        answer,
                    } => {
                        share.pending = Some(Pending {
                            peer,
                            name,
                            requested: control_requested,
                            control: control_requested,
                            files_requested,
                            files: files_requested,
                            remember: false,
                            answer,
                        });
                    }
                    HostEvent::Connected {
                        peer,
                        permissions,
                        connection,
                    } => {
                        share.pending = None;
                        share.connection = Some(connection);
                        share.permissions = permissions;
                        share.status = format!(
                            "{}... | control {} | files {}",
                            &peer[..12],
                            permissions.control,
                            permissions.files
                        );
                    }
                    HostEvent::Disconnected(message) => {
                        if share
                            .connection
                            .as_ref()
                            .is_none_or(|connection| connection.close_reason().is_some())
                        {
                            share.connection = None;
                            share.status = message;
                        }
                    }
                    HostEvent::Transfer(event) => {
                        self.transfers.insert(event.id, event);
                    }
                    HostEvent::Error(message) => {
                        share.status = message;
                        share.stop.cancel();
                    }
                    HostEvent::Stopped => share.status = "Sharing stopped".into(),
                }
            }
            if share
                .pending
                .as_ref()
                .is_some_and(|pending| pending.answer.is_closed())
            {
                share.pending = None;
            }
        }
        let mut finished = false;
        if let Some(view) = &mut self.view {
            while let Ok(event) = view.events.try_recv() {
                match event {
                    ViewerEvent::Identity(identity) => view.identity = identity,
                    ViewerEvent::Connected {
                        desktop,
                        permissions,
                    } => {
                        view.screen = Some(desktop.screen);
                        view.displays = desktop.displays;
                        view.control = permissions.control;
                        view.files = permissions.files;
                        self.paused = false;
                        self.selected_display = desktop.active_display;
                        self.update_rate = desktop.rate;
                        self.status = "Connected. Click the remote screen to control it.".into();
                    }
                    ViewerEvent::Clipboard(text) => {
                        ctx.copy_text(text);
                        self.status = "Remote clipboard copied.".into();
                    }
                    ViewerEvent::Notice(message) => self.status = message,
                    ViewerEvent::Path(path) => view.path = path,
                    ViewerEvent::Statistics(snapshot) => view.network = Some(snapshot),
                    ViewerEvent::CaptureState(state) => {
                        self.paused = state.paused;
                        self.selected_display = state.display;
                        self.update_rate = state.rate;
                    }
                    ViewerEvent::Transfer(event) => {
                        self.transfers.insert(event.id, event);
                    }
                    ViewerEvent::Reconnecting { attempt, reason } => {
                        view.control = false;
                        view.files = false;
                        view.texture = None;
                        view.network = None;
                        self.held.clear();
                        self.buttons.clear();
                        self.status = format!("Reconnecting {attempt}/5: {reason}");
                        for transfer in self.transfers.values_mut() {
                            if matches!(transfer.state, TransferState::Running) {
                                transfer.state = TransferState::Failed(
                                    "Connection interrupted. Send the file again.".into(),
                                );
                            }
                        }
                    }
                    ViewerEvent::Finished(message) => {
                        self.status = message;
                        finished = true;
                    }
                }
            }
            if view.frames.has_changed().unwrap_or(false)
                && let Some(frame) = view.frames.borrow_and_update().clone()
            {
                let image = egui::ColorImage::from_rgba_unmultiplied(
                    [frame.screen.width as usize, frame.screen.height as usize],
                    &frame.rgba,
                );
                if let Some(texture) = &mut view.texture {
                    texture.set(image, egui::TextureOptions::LINEAR);
                } else {
                    view.texture = Some(ctx.load_texture(
                        "remote-desktop",
                        image,
                        egui::TextureOptions::LINEAR,
                    ));
                }
                view.screen = Some(frame.screen.clone());
            }
        }
        if finished {
            self.disconnect();
        }
    }
    fn send(&mut self, message: ClientMessage) {
        if let Some(view) = &self.view
            && view.commands.try_send(message).is_err()
        {
            view.stop.cancel();
            self.status = "Connection is not keeping up. Disconnected to release held keys; reconnect to continue.".into();
        }
    }

    fn input(&mut self, event: InputEvent) {
        self.send(ClientMessage::Input(event));
    }

    fn release(&mut self) {
        if !self.held.is_empty() || !self.buttons.is_empty() {
            self.input(InputEvent::ReleaseAll);
        }
        self.held.clear();
        self.buttons.clear();
        self.scroll = Vec2::ZERO;
    }

    fn modifiers(&mut self, modifiers: egui::Modifiers, remote_mac: bool) {
        let (mut control, mut meta) = (modifiers.ctrl, modifiers.mac_cmd);
        if self.map_shortcuts && cfg!(target_os = "macos") && !remote_mac {
            control |= meta;
            meta = false;
        }
        if self.map_shortcuts && !cfg!(target_os = "macos") && remote_mac {
            meta |= control;
            control = false;
        }
        for (key, down) in [
            (KeyCode::Control, control),
            (KeyCode::Meta, meta),
            (KeyCode::Shift, modifiers.shift),
            (KeyCode::Alt, modifiers.alt),
        ] {
            if self.held.contains(&key) != down {
                self.input(InputEvent::Key { key, down });
                if down {
                    self.held.insert(key);
                } else {
                    self.held.remove(&key);
                }
            }
        }
    }

    fn shortcut(&mut self, letter: char, remote_mac: bool) {
        self.input(InputEvent::ReleaseAll);
        self.held.clear();
        self.buttons.clear();
        let key = if remote_mac {
            KeyCode::Meta
        } else {
            KeyCode::Control
        };
        self.input(InputEvent::Key { key, down: true });
        self.input(InputEvent::Key {
            key: KeyCode::Letter(letter),
            down: true,
        });
        self.input(InputEvent::Key {
            key: KeyCode::Letter(letter),
            down: false,
        });
        self.input(InputEvent::Key { key, down: false });
    }

    fn remote_input(&mut self, ui: &mut egui::Ui, response: &egui::Response, remote_mac: bool) {
        let window_focused = ui.input(|input| input.focused);
        if response.clicked() {
            response.request_focus();
        }
        let focused = response.has_focus() && window_focused;
        if !focused {
            self.release();
            return;
        }
        ui.memory_mut(|memory| {
            memory.set_focus_lock_filter(
                response.id,
                egui::EventFilter {
                    tab: true,
                    horizontal_arrows: true,
                    vertical_arrows: true,
                    escape: true,
                },
            )
        });
        ui.output_mut(|output| {
            output.ime = Some(egui::output::IMEOutput {
                purpose: egui::IMEPurpose::Normal,
                rect: response.rect,
                cursor_rect: response.rect,
                should_interrupt_composition: false,
            })
        });
        let events = ui.input(|input| input.events.clone());
        let clipboard_event = events.iter().any(|event| {
            matches!(
                event,
                egui::Event::Copy | egui::Event::Cut | egui::Event::Paste(_)
            )
        });
        for event in events {
            match event {
                egui::Event::PointerMoved(pos)
                    if response.rect.contains(pos) || !self.buttons.is_empty() =>
                {
                    let (x, y) = normalized(response.rect, pos);
                    self.input(InputEvent::Move { x, y });
                }
                egui::Event::PointerButton {
                    pos,
                    button,
                    pressed,
                    modifiers,
                } => {
                    self.modifiers(modifiers, remote_mac);
                    let button = match button {
                        egui::PointerButton::Primary => PointerButton::Left,
                        egui::PointerButton::Secondary => PointerButton::Right,
                        egui::PointerButton::Middle => PointerButton::Middle,
                        _ => continue,
                    };
                    if response.rect.contains(pos) || (!pressed && self.buttons.contains(&button)) {
                        let (x, y) = normalized(response.rect, pos);
                        self.input(InputEvent::Move { x, y });
                        self.input(InputEvent::Button {
                            button,
                            down: pressed,
                        });
                        if pressed {
                            self.buttons.insert(button);
                        } else {
                            self.buttons.remove(&button);
                        }
                    }
                }
                egui::Event::MouseWheel {
                    delta,
                    modifiers,
                    unit,
                    ..
                } if response.hovered() => {
                    self.modifiers(modifiers, remote_mac);
                    let scale = match unit {
                        egui::MouseWheelUnit::Point => 1.0 / 24.0,
                        egui::MouseWheelUnit::Line => 1.0,
                        egui::MouseWheelUnit::Page => 20.0,
                    };
                    self.scroll = (self.scroll - delta * scale)
                        .clamp(Vec2::splat(-100.0), Vec2::splat(100.0));
                    let (x, y) = (self.scroll.x.trunc() as i32, self.scroll.y.trunc() as i32);
                    self.scroll -= Vec2::new(x as f32, y as f32);
                    if x != 0 || y != 0 {
                        self.input(InputEvent::Scroll { x, y });
                    }
                }
                egui::Event::ModifiersChanged(modifiers) => self.modifiers(modifiers, remote_mac),
                egui::Event::Key {
                    key,
                    pressed,
                    modifiers,
                    ..
                } => {
                    self.modifiers(modifiers, remote_mac);
                    if clipboard_event && matches!(key, Key::C | Key::V | Key::X) {
                        continue;
                    }
                    if let Some(code) = key_code(key) {
                        let printable = matches!(
                            code,
                            KeyCode::Letter(_)
                                | KeyCode::Symbol(_)
                                | KeyCode::Digit(_)
                                | KeyCode::Space
                        );
                        if pressed
                            && (!printable || modifiers.ctrl || modifiers.mac_cmd || modifiers.alt)
                        {
                            self.input(InputEvent::Key {
                                key: code,
                                down: true,
                            });
                            self.held.insert(code);
                        } else if !pressed && self.held.remove(&code) {
                            self.input(InputEvent::Key {
                                key: code,
                                down: false,
                            });
                        }
                    }
                }
                egui::Event::Text(text) | egui::Event::Ime(egui::ImeEvent::Commit(text)) => {
                    if !text.is_empty() && text.len() <= TEXT_LIMIT {
                        self.input(InputEvent::Text(text));
                    }
                }
                egui::Event::Paste(text) => {
                    if text.len() <= TEXT_LIMIT {
                        self.input(InputEvent::ReleaseAll);
                        self.held.clear();
                        self.buttons.clear();
                        self.input(InputEvent::Text(text));
                    } else {
                        self.status = "Clipboard text exceeds 32 KiB.".into();
                    }
                }
                egui::Event::Copy => self.shortcut('c', remote_mac),
                egui::Event::Cut => self.shortcut('x', remote_mac),
                egui::Event::PointerGone => self.release(),
                _ => (),
            }
        }
        self.modifiers(ui.input(|input| input.modifiers), remote_mac);
    }

    fn upload(&mut self, path: std::path::PathBuf) {
        if let Some(view) = &self.view
            && view.files
        {
            let id = rand::random();
            match view.uploads.try_send(Upload { id, path }) {
                Ok(()) => self.files_open = true,
                Err(error) => self.status = error.to_string(),
            }
        } else if let Some(share) = &self.share
            && share.permissions.files
            && let Some(connection) = &share.connection
        {
            let connection = connection.clone();
            let events = share.emit.clone();
            self.files_open = true;
            self.runtime.spawn(async move {
                let sink: crate::files::TransferSink = Arc::new(move |event| {
                    let _ = events.send(HostEvent::Transfer(event));
                });
                let _ = crate::files::send(
                    &connection,
                    Upload {
                        id: rand::random(),
                        path,
                    },
                    &sink,
                )
                .await;
            });
        }
    }
    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.heading("Rust Remote Office V1");
        ui.add_space(10.0);
        ui.label("Device name");
        ui.text_edit_singleline(&mut self.name);
        ui.label("Receive directory (new connections)");
        ui.text_edit_singleline(&mut self.receive_dir);
        ui.checkbox(&mut self.host_on_launch, "Start sharing when app opens");
        ui.horizontal(|ui| {
            ui.label("Host UDP port");
            ui.add(egui::DragValue::new(&mut self.listen_port).range(1024..=65535));
        });
        ui.horizontal(|ui| {
            if ui.button("Save settings").clicked() {
                match self.save_settings() {
                    Ok(()) => self.status = "Settings saved".into(),
                    Err(error) => self.status = error.to_string(),
                }
            }
            if ui.button("Trusted devices").clicked() {
                self.devices_open = true;
            }
            if ui.button("Files").clicked() {
                self.files_open = true;
            }
        });
        ui.separator();
        ui.heading("Share this computer");
        if self.share.is_none() {
            ui.add_enabled_ui(native::supported(), |ui| {
                ui.checkbox(&mut self.relay, "Use relay assistance");
                if self.relay {
                    ui.label("Relay URL (empty = public service)");
                    ui.text_edit_singleline(&mut self.relay_url);
                }
                if ui.button("Load displays").clicked() {
                    match native::monitors() {
                        Ok(monitors) => {
                            self.monitors = monitors;
                            self.monitor = 0;
                        }
                        Err(error) => self.status = error.to_string(),
                    }
                }
                if !self.monitors.is_empty() {
                    egui::ComboBox::from_id_salt("local-monitor")
                        .selected_text(&self.monitors[self.monitor].name)
                        .show_ui(ui, |ui| {
                            for display in &self.monitors {
                                ui.selectable_value(
                                    &mut self.monitor,
                                    display.index,
                                    &display.name,
                                );
                            }
                        });
                }
                if ui.button("Start sharing").clicked() {
                    self.start_share();
                }
            });
            if !native::supported() {
                ui.small("Sharing is available on macOS and Windows.");
            }
        } else {
            let share = self.share.as_ref().unwrap();
            ui.label(&share.status);
            if !share.invite.is_empty() && ui.button("Copy invite").clicked() {
                ui.ctx().copy_text(share.invite.clone());
            }
            if let Some(connection) = &share.connection
                && ui.button("Disconnect current device").clicked()
            {
                connection.close(1u32.into(), b"Host disconnected");
            }
            if ui
                .button(RichText::new("Stop sharing").color(Color32::LIGHT_RED))
                .clicked()
            {
                self.stop_share();
            }
        }
        ui.separator();
        ui.heading("Connect to a computer");
        ui.add_enabled_ui(self.view.is_none(), |ui| {
            ui.add(
                egui::TextEdit::multiline(&mut self.invite)
                    .desired_rows(3)
                    .desired_width(f32::INFINITY)
                    .hint_text("rro1:..."),
            );
            ui.checkbox(
                &mut self.request_control,
                "Request keyboard, mouse and clipboard",
            );
            ui.checkbox(&mut self.request_files, "Request file transfer");
            ui.checkbox(&mut self.reconnect, "Automatically reconnect");
            if ui.button("Connect").clicked()
                && let Err(error) = self.connect()
            {
                self.status = error.to_string();
            }
        });
        if let Some(view) = &self.view {
            ui.small("This device identity:");
            ui.add(egui::Label::new(RichText::new(&view.identity).monospace().small()).wrap());
            if ui.button("Disconnect").clicked() {
                self.disconnect();
            }
        }
    }
    fn approval_window(&mut self, ctx: &egui::Context) {
        let mut answer = None;
        if let Some(pending) = self.share.as_mut().and_then(|share| share.pending.as_mut()) {
            egui::Window::new("Connection request")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, Vec2::ZERO)
                .show(ctx, |ui| {
                    ui.heading(format!("{} wants to connect", pending.name));
                    ui.label("Compare this identity with their computer:");
                    ui.add(egui::Label::new(RichText::new(&pending.peer).monospace()).wrap());
                    ui.add_enabled(
                        pending.requested,
                        egui::Checkbox::new(
                            &mut pending.control,
                            "Allow keyboard, mouse and clipboard",
                        ),
                    );
                    ui.add_enabled(
                        pending.files_requested,
                        egui::Checkbox::new(
                            &mut pending.files,
                            "Allow sending and requesting files",
                        ),
                    );
                    ui.checkbox(
                        &mut pending.remember,
                        "Trust this device for unattended access",
                    );
                    ui.horizontal(|ui| {
                        if ui.button("Decline").clicked() {
                            answer = Some(Approval::default());
                        }
                        if ui.button("Allow connection").clicked() {
                            answer = Some(Approval {
                                allow: true,
                                control: pending.control,
                                files: pending.files,
                                remember: pending.remember,
                            });
                        }
                    });
                });
        }
        if let Some(answer) = answer
            && let Some(pending) = self.share.as_mut().and_then(|share| share.pending.take())
        {
            let _ = pending.answer.send(answer);
        }
    }
    fn device_window(&mut self, ctx: &egui::Context) {
        let mut open = self.devices_open;
        egui::Window::new("Trusted devices")
            .open(&mut open)
            .show(ctx, |ui| {
                let peers = self.store.access.trusted();
                if peers.is_empty() {
                    ui.label("Trust a device when approving its first connection.");
                }
                for (id, permissions) in peers {
                    ui.add(egui::Label::new(RichText::new(&id).monospace()).wrap());
                    ui.horizontal(|ui| {
                        ui.label(format!(
                            "control: {} | files: {}",
                            permissions.control, permissions.files
                        ));
                        if ui.button("Forget device").clicked()
                            && let Err(error) = self.store.access.forget(&id)
                        {
                            self.status = error.to_string();
                        }
                    });
                    ui.separator();
                }
            });
        self.devices_open = open;
    }
    fn file_window(&mut self, ctx: &egui::Context) {
        let mut open = self.files_open;
        egui::Window::new("Files")
            .open(&mut open)
            .default_width(620.0)
            .show(ctx, |ui| {
                ui.label(format!("Receive directory: {}", self.receive_dir));
                let allowed = self.view.as_ref().is_some_and(|view| view.files);
                let host_upload = self
                    .share
                    .as_ref()
                    .is_some_and(|share| share.permissions.files && share.connection.is_some());
                ui.label(if allowed {
                    "Send to the connected computer"
                } else {
                    "Send to the device controlling this computer"
                });
                ui.add_enabled_ui(allowed || host_upload, |ui| {
                    ui.label("Local file (or drag a file into this window)");
                    ui.text_edit_singleline(&mut self.local_file);
                    if ui.button("Send file").clicked() {
                        self.upload(self.local_file.clone().into());
                    }
                });
                ui.add_enabled_ui(allowed, |ui| {
                    ui.label("Remote file path");
                    ui.text_edit_singleline(&mut self.remote_file);
                    if ui.button("Download file").clicked() {
                        self.send(ClientMessage::RequestFile {
                            id: rand::random(),
                            path: self.remote_file.clone(),
                        });
                    }
                });
                egui::ScrollArea::vertical()
                    .max_height(300.0)
                    .show(ui, |ui| {
                        for event in self.transfers.values().rev() {
                            ui.label(format!(
                                "{} {}",
                                if event.incoming {
                                    "Receiving"
                                } else {
                                    "Sending"
                                },
                                event.name
                            ));
                            let fraction = if event.total == 0 {
                                1.0
                            } else {
                                event.bytes as f32 / event.total as f32
                            };
                            ui.add(
                                egui::ProgressBar::new(fraction)
                                    .text(format!("{} / {} bytes", event.bytes, event.total)),
                            );
                            match &event.state {
                                TransferState::Running => {}
                                TransferState::Complete(path) => {
                                    ui.small(format!("Complete: {}", path.display()));
                                }
                                TransferState::Failed(message) => {
                                    ui.colored_label(Color32::LIGHT_RED, message);
                                }
                            }
                        }
                    });
            });
        self.files_open = open;
    }
    fn session_toolbar(&mut self, ui: &mut egui::Ui) {
        let connected = self.view.as_ref().is_some_and(|view| view.screen.is_some());
        ui.add_enabled_ui(connected, |ui| {
            ui.horizontal_wrapped(|ui| {
                if ui.checkbox(&mut self.paused, "Pause").changed() {
                    self.paused_by_window = false;
                    self.release();
                    self.send(ClientMessage::Pause(self.paused));
                }
                ui.checkbox(&mut self.pause_when_minimized, "Pause when minimized");
                let before = self.selected_display;
                if let Some(view) = &self.view {
                    let name = view
                        .displays
                        .iter()
                        .find(|display| display.index == self.selected_display)
                        .map(|display| display.name.as_str())
                        .unwrap_or("Display");
                    egui::ComboBox::from_id_salt("remote-display")
                        .selected_text(name)
                        .show_ui(ui, |ui| {
                            for display in &view.displays {
                                ui.selectable_value(
                                    &mut self.selected_display,
                                    display.index,
                                    &display.name,
                                );
                            }
                        });
                }
                if self.selected_display != before {
                    self.release();
                    self.send(ClientMessage::SelectDisplay(self.selected_display));
                }
                ui.label("Target updates/s");
                if ui
                    .add(egui::DragValue::new(&mut self.update_rate).range(1..=60))
                    .changed()
                {
                    self.send(ClientMessage::SetUpdateRate(self.update_rate));
                }
                egui::ComboBox::from_id_salt("zoom")
                    .selected_text(if self.zoom == 0.0 {
                        "Fit".into()
                    } else {
                        format!("{}%", self.zoom * 100.0)
                    })
                    .show_ui(ui, |ui| {
                        for (value, label) in
                            [(0.0, "Fit"), (1.0, "100%"), (1.5, "150%"), (2.0, "200%")]
                        {
                            ui.selectable_value(&mut self.zoom, value, label);
                        }
                    });
                if ui.button("Fullscreen").clicked() {
                    self.fullscreen = !self.fullscreen;
                    ui.ctx()
                        .send_viewport_cmd(egui::ViewportCommand::Fullscreen(self.fullscreen));
                }
                if ui.button("Files").clicked() {
                    self.files_open = true;
                }
            });
        });
        let control = self.view.as_ref().is_some_and(|view| view.control);
        ui.add_enabled_ui(control, |ui| {
            ui.horizontal_wrapped(|ui| {
                let mac = self
                    .view
                    .as_ref()
                    .and_then(|view| view.screen.as_ref())
                    .is_some_and(|screen| screen.platform == "macos");
                if ui.button("Send clipboard text").clicked() {
                    match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_text()) {
                        Ok(text) => self.send(ClientMessage::SetClipboard(text)),
                        Err(error) => self.status = error.to_string(),
                    }
                }
                if ui.button("Get clipboard text").clicked() {
                    self.send(ClientMessage::GetClipboard);
                }
                if ui.button("Paste on remote").clicked() {
                    self.shortcut('v', mac);
                }
                if ui
                    .checkbox(&mut self.map_shortcuts, "Map Cmd / Ctrl")
                    .changed()
                {
                    self.release();
                }
            });
        });
    }
}

impl eframe::App for OfficeApp {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll(ctx);
        let minimized = ctx.input(|input| input.viewport().minimized == Some(true));
        if self.pause_when_minimized
            && minimized
            && !self.paused
            && self
                .view
                .as_ref()
                .is_some_and(|view| view.texture.is_some())
        {
            self.release();
            self.paused = true;
            self.paused_by_window = true;
            self.send(ClientMessage::Pause(true));
        } else if !minimized && self.paused_by_window {
            self.paused_by_window = false;
            self.paused = false;
            self.send(ClientMessage::Pause(false));
        }
        if ctx.input(|input| input.viewport().focused == Some(false)) {
            self.release();
        }
        ctx.request_repaint_after(Duration::from_millis(33));
    }
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.poll(&ctx);
        ctx.request_repaint_after(Duration::from_millis(33));
        let dropped = ctx.input(|input| {
            input
                .raw
                .dropped_files
                .iter()
                .map(|file| file.path().to_path_buf())
                .collect::<Vec<_>>()
        });
        for path in dropped {
            self.upload(path);
        }
        egui::Panel::left("sidebar")
            .resizable(false)
            .exact_size(330.0)
            .show(ui, |ui| {
                egui::ScrollArea::vertical().show(ui, |ui| self.sidebar(ui));
            });
        egui::CentralPanel::default().show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Remote desktop");
                if let Some(view) = &self.view {
                    ui.colored_label(Color32::LIGHT_GREEN, &view.path);
                }
            });
            ui.label(&self.status);
            if let Some(network) = self.view.as_ref().and_then(|view| view.network.as_ref()) {
                ui.small(format!(
                    "RTT {:.0} ms | {:.1} KiB/s | {:.1} updates/s | decode {:.1} ms",
                    network.rtt_ms.unwrap_or(0.0),
                    network.screen_kib_per_second,
                    network.updates_per_second,
                    network.processing_ms
                ));
            }
            self.session_toolbar(ui);
            ui.separator();
            let image = self.view.as_ref().and_then(|view| {
                view.texture
                    .as_ref()
                    .map(|texture| (texture.id(), texture.size_vec2()))
            });
            if let Some((texture, size)) = image {
                let available = ui.available_size().max(Vec2::splat(1.0));
                let scale = if self.zoom == 0.0 {
                    (available.x / size.x).min(available.y / size.y)
                } else {
                    self.zoom / ctx.pixels_per_point()
                };
                egui::ScrollArea::both()
                    .scroll_source(egui::scroll_area::ScrollSource::SCROLL_BAR)
                    .show(ui, |ui| {
                        let response = ui.add(
                            egui::Image::new((texture, size))
                                .fit_to_exact_size(size * scale)
                                .sense(egui::Sense::click_and_drag()),
                        );
                        let controlled =
                            self.view.as_ref().is_some_and(|view| view.control) && !self.paused;
                        if controlled {
                            let mac = self
                                .view
                                .as_ref()
                                .and_then(|view| view.screen.as_ref())
                                .is_some_and(|screen| screen.platform == "macos");
                            self.remote_input(ui, &response, mac);
                        }
                    });
            } else {
                ui.vertical_centered(|ui| {
                    ui.add_space(100.0);
                    ui.heading("Your other desktop, here.");
                    ui.label("Share, paste an invite, and connect.");
                });
            }
        });
        self.approval_window(&ctx);
        self.device_window(&ctx);
        self.file_window(&ctx);
    }
}
impl Drop for OfficeApp {
    fn drop(&mut self) {
        self.stop_share();
        self.disconnect();
    }
}

fn normalized(rect: egui::Rect, position: egui::Pos2) -> (u16, u16) {
    let axis = |p: f32, min: f32, extent: f32| {
        (((p - min) / extent.max(1.0)).clamp(0.0, 1.0) * f32::from(u16::MAX)).round() as u16
    };
    (
        axis(position.x, rect.left(), rect.width()),
        axis(position.y, rect.top(), rect.height()),
    )
}

fn key_code(key: Key) -> Option<KeyCode> {
    let name = key.name();
    if name.len() == 1 {
        let letter = name.chars().next()?;
        if letter.is_ascii_alphabetic() {
            return Some(KeyCode::Letter(letter.to_ascii_lowercase()));
        }
        if letter.is_ascii_digit() {
            return Some(KeyCode::Digit(letter as u8 - b'0'));
        }
        if letter.is_ascii_punctuation() {
            return Some(KeyCode::Symbol(letter));
        }
    }
    Some(match key {
        Key::ArrowLeft => KeyCode::Left,
        Key::ArrowRight => KeyCode::Right,
        Key::ArrowUp => KeyCode::Up,
        Key::ArrowDown => KeyCode::Down,
        Key::Enter => KeyCode::Enter,
        Key::Escape => KeyCode::Escape,
        Key::Backspace => KeyCode::Backspace,
        Key::Tab => KeyCode::Tab,
        Key::Space => KeyCode::Space,
        Key::Delete => KeyCode::Delete,
        Key::Insert => KeyCode::Insert,
        Key::Home => KeyCode::Home,
        Key::End => KeyCode::End,
        Key::PageUp => KeyCode::PageUp,
        Key::PageDown => KeyCode::PageDown,
        _ => KeyCode::Function(
            name.strip_prefix('F')?
                .parse::<u8>()
                .ok()
                .filter(|n| (1..=12).contains(n))?,
        ),
    })
}
