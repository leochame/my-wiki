use crate::{
    protocol::{
        CaptureState, DesktopInfo, DisplayInfo, FrameDelta, FrameEncoder, HostMessage, InputEvent,
        ScreenInfo,
    },
    transport::FramePacer,
};
use anyhow::Result;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;

pub struct RawScreen {
    pub info: ScreenInfo,
    pub rgba: Vec<u8>,
}
pub struct CapturedFrame {
    pub delta: FrameDelta,
    pub credit: tokio::sync::OwnedSemaphorePermit,
}

pub trait ScreenCapture {
    fn capture(&mut self) -> Result<RawScreen>;
    fn displays(&mut self) -> Result<Vec<DisplayInfo>>;
    fn select_display(&mut self, index: usize) -> Result<()>;
}

pub trait DesktopInput {
    fn input(&mut self, event: InputEvent, screen: &ScreenInfo) -> Result<()>;
    fn clipboard(&mut self) -> Result<String>;
    fn set_clipboard(&mut self, text: String) -> Result<()>;
    fn release_all(&mut self);
}

#[derive(Clone)]
pub struct BackendFactory {
    pub capture: Arc<dyn Fn() -> Result<Box<dyn ScreenCapture>> + Send + Sync>,
    pub input: Arc<dyn Fn() -> Result<Box<dyn DesktopInput>> + Send + Sync>,
}

pub struct StopOnDrop(pub CancellationToken);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

pub enum CaptureCommand {
    Pause(bool),
    SelectDisplay(usize),
    SetUpdateRate(u32),
}
pub enum InputCommand {
    Input {
        event: InputEvent,
        screen: ScreenInfo,
    },
    SetClipboard(String),
    GetClipboard,
}
pub struct CaptureReady {
    pub desktop: DesktopInfo,
    pub screen: watch::Receiver<ScreenInfo>,
}

pub struct CaptureWorker {
    pub factory: BackendFactory,
    pub monitor: usize,
    pub pacing: Arc<FramePacer>,
    pub ready: oneshot::Sender<Result<CaptureReady, String>>,
    pub frames: mpsc::Sender<CapturedFrame>,
    pub commands: mpsc::Receiver<CaptureCommand>,
    pub replies: mpsc::UnboundedSender<HostMessage>,
    pub stop: CancellationToken,
}

impl CaptureWorker {
    pub fn run(mut self) -> Result<()> {
        let initial = (|| {
            let mut backend = (self.factory.capture)()?;
            let displays = backend.displays()?;
            let first = backend.capture()?;
            Ok::<_, anyhow::Error>((backend, displays, first))
        })();
        let (mut backend, displays, first) = match initial {
            Ok(value) => value,
            Err(error) => {
                let _ = self.ready.send(Err(error.to_string()));
                return Err(error);
            }
        };
        let (screen_tx, screen) = watch::channel(first.info.clone());
        let _ = self.ready.send(Ok(CaptureReady {
            desktop: DesktopInfo {
                screen: first.info.clone(),
                displays,
                active_display: self.monitor,
                rate: self.pacing.rate(),
            },
            screen,
        }));
        let mut first = Some(first);
        let mut encoder = FrameEncoder::default();
        let mut next_frame = Instant::now();
        let mut paused = false;
        let mut selected = self.monitor;
        while !self.stop.is_cancelled() {
            while let Ok(command) = self.commands.try_recv() {
                match command {
                    CaptureCommand::Pause(value) => paused = value,
                    CaptureCommand::SetUpdateRate(rate) => self.pacing.set_rate(rate),
                    CaptureCommand::SelectDisplay(index) => match backend.select_display(index) {
                        Ok(()) => {
                            selected = index;
                            first = None;
                            next_frame = Instant::now();
                        }
                        Err(error) => {
                            let _ = self.replies.send(HostMessage::Notice(error.to_string()));
                        }
                    },
                }
                let _ = self.replies.send(HostMessage::CaptureState(CaptureState {
                    paused,
                    display: selected,
                    rate: self.pacing.rate(),
                }));
            }
            if !paused
                && Instant::now() >= next_frame
                && let Ok(credit) = self.pacing.credit.clone().try_acquire_owned()
                && let Ok(permit) = self.frames.try_reserve()
            {
                let raw = match first.take() {
                    Some(raw) => raw,
                    None => backend.capture()?,
                };
                if *screen_tx.borrow() != raw.info {
                    screen_tx.send_replace(raw.info.clone());
                }
                if let Some(delta) = encoder.encode(&raw.info, &raw.rgba)? {
                    permit.send(CapturedFrame { delta, credit });
                }
                next_frame = Instant::now() + self.pacing.interval();
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
}

struct InputGuard(Box<dyn DesktopInput>);
impl Drop for InputGuard {
    fn drop(&mut self) {
        self.0.release_all();
    }
}

pub struct InputWorker {
    pub factory: BackendFactory,
    pub commands: mpsc::Receiver<InputCommand>,
    pub replies: mpsc::UnboundedSender<HostMessage>,
    pub stop: CancellationToken,
}

impl InputWorker {
    pub fn run(mut self) -> Result<()> {
        let mut backend = InputGuard((self.factory.input)()?);
        while let Some(command) = self.commands.blocking_recv() {
            if self.stop.is_cancelled() {
                break;
            }
            let result = match command {
                InputCommand::Input { event, screen } => {
                    backend.0.input(event, &screen).map(|_| None)
                }
                InputCommand::SetClipboard(text) => backend.0.set_clipboard(text).map(|_| None),
                InputCommand::GetClipboard => backend
                    .0
                    .clipboard()
                    .map(|text| Some(HostMessage::Clipboard(text))),
            };
            match result {
                Ok(Some(reply)) => {
                    let _ = self.replies.send(reply);
                }
                Err(error) => {
                    let _ = self.replies.send(HostMessage::Notice(error.to_string()));
                }
                _ => (),
            }
        }
        Ok(())
    }
}

#[cfg(feature = "desktop")]
pub mod native;
