use crate::{
    capture::{DesktopInput, RawScreen, ScreenCapture},
    protocol::{DisplayInfo, InputEvent, KeyCode, PointerButton, ScreenInfo},
};
use anyhow::{Context, Result};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
#[cfg(target_os = "macos")]
use screencapturekit::{
    prelude::*,
    screenshot_manager::{CGImageExt, SCScreenshotManager},
};
use std::collections::HashSet;

pub struct NativeCapture {
    #[cfg(target_os = "windows")]
    monitor: xcap::Monitor,
    #[cfg(target_os = "macos")]
    display: SCDisplay,
    #[cfg(target_os = "macos")]
    filter: SCContentFilter,
    #[cfg(target_os = "macos")]
    configuration: SCStreamConfiguration,
}

#[derive(Default)]
pub struct NativeInput {
    input: Option<Enigo>,
    clipboard: Option<arboard::Clipboard>,
    keys: HashSet<KeyCode>,
    buttons: HashSet<PointerButton>,
}

#[cfg(target_os = "windows")]
fn displays() -> Result<Vec<xcap::Monitor>> {
    let mut values = xcap::Monitor::all()?;
    values.sort_by_cached_key(|display| display.id().expect("display id"));
    Ok(values)
}
#[cfg(target_os = "macos")]
fn displays() -> Result<Vec<SCDisplay>> {
    let mut values = SCShareableContent::get()?.displays();
    values.sort_by_key(SCDisplay::display_id);
    Ok(values)
}

pub fn display_infos() -> Result<Vec<DisplayInfo>> {
    displays()?
        .iter()
        .enumerate()
        .map(|(index, display)| {
            #[cfg(target_os = "windows")]
            {
                Ok(DisplayInfo {
                    index,
                    name: display.friendly_name()?,
                    width: display.width()?,
                    height: display.height()?,
                })
            }
            #[cfg(target_os = "macos")]
            {
                Ok(DisplayInfo {
                    index,
                    name: format!("Display {}", display.display_id()),
                    width: display.width(),
                    height: display.height(),
                })
            }
        })
        .collect()
}

impl NativeCapture {
    pub fn open(index: usize) -> Result<Self> {
        let display = displays()?
            .into_iter()
            .nth(index)
            .context("Display does not exist")?;
        #[cfg(target_os = "macos")]
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build()?;
        #[cfg(target_os = "macos")]
        let configuration = {
            let info =
                screencapturekit::shareable_content::SCShareableContentInfo::for_filter(&filter)
                    .context("ScreenCaptureKit content info is unavailable")?;
            let (width, height) = info.pixel_size();
            SCStreamConfiguration::new()
                .with_width(width)
                .with_height(height)
                .with_shows_cursor(false)
        };
        Ok(Self {
            #[cfg(target_os = "windows")]
            monitor: display,
            #[cfg(target_os = "macos")]
            display,
            #[cfg(target_os = "macos")]
            filter,
            #[cfg(target_os = "macos")]
            configuration,
        })
    }
}

impl ScreenCapture for NativeCapture {
    fn capture(&mut self) -> Result<RawScreen> {
        #[cfg(target_os = "windows")]
        let (info, mut rgba) = {
            let image = self.monitor.capture_image()?;
            let info = ScreenInfo {
                name: self.monitor.friendly_name()?,
                platform: "windows".into(),
                width: image.width(),
                height: image.height(),
                input_x: self.monitor.x()?,
                input_y: self.monitor.y()?,
                input_width: self.monitor.width()?,
                input_height: self.monitor.height()?,
            };
            (info, image.into_raw())
        };
        #[cfg(target_os = "macos")]
        let (info, mut rgba) = {
            let image = SCScreenshotManager::capture_image(&self.filter, &self.configuration)?;
            let frame = self.display.frame();
            let info = ScreenInfo {
                name: format!("Display {}", self.display.display_id()),
                platform: "macos".into(),
                width: image.width() as u32,
                height: image.height() as u32,
                input_x: frame.origin.x as i32,
                input_y: frame.origin.y as i32,
                input_width: frame.size.width as u32,
                input_height: frame.size.height as u32,
            };
            (info, image.rgba_data()?)
        };
        for pixel in rgba.as_chunks_mut::<4>().0 {
            pixel[3] = 255;
        }
        Ok(RawScreen { info, rgba })
    }
    fn displays(&mut self) -> Result<Vec<DisplayInfo>> {
        display_infos()
    }
    fn select_display(&mut self, index: usize) -> Result<()> {
        *self = Self::open(index)?;
        Ok(())
    }
}

impl NativeInput {
    fn enigo(&mut self) -> Result<&mut Enigo> {
        if self.input.is_none() {
            self.input = Some(
                Enigo::new(&Settings::default())
                    .context("Enable Accessibility permission on macOS to allow input")?,
            );
        }
        Ok(self.input.as_mut().unwrap())
    }
    fn clipboard_handle(&mut self) -> Result<&mut arboard::Clipboard> {
        if self.clipboard.is_none() {
            self.clipboard = Some(arboard::Clipboard::new()?);
        }
        Ok(self.clipboard.as_mut().unwrap())
    }
}

impl DesktopInput for NativeInput {
    fn input(&mut self, event: InputEvent, screen: &ScreenInfo) -> Result<()> {
        match event {
            InputEvent::Move { x, y } => {
                let (x, y) = screen.input_position(x, y);
                self.enigo()?.move_mouse(x, y, Coordinate::Abs)?;
            }
            InputEvent::Button { button, down } => {
                self.enigo()?
                    .button(native_button(button), direction(down))?;
                if down {
                    self.buttons.insert(button);
                } else {
                    self.buttons.remove(&button);
                }
            }
            InputEvent::Scroll { x, y } => {
                if x != 0 {
                    self.enigo()?.scroll(x, Axis::Horizontal)?;
                }
                if y != 0 {
                    self.enigo()?.scroll(y, Axis::Vertical)?;
                }
            }
            InputEvent::Key { key, down } => {
                self.enigo()?.key(native_key(key), direction(down))?;
                if down {
                    self.keys.insert(key);
                } else {
                    self.keys.remove(&key);
                }
            }
            InputEvent::Text(text) => self.enigo()?.text(&text)?,
            InputEvent::ReleaseAll => self.release_all(),
        }
        Ok(())
    }
    fn clipboard(&mut self) -> Result<String> {
        Ok(self.clipboard_handle()?.get_text()?)
    }
    fn set_clipboard(&mut self, text: String) -> Result<()> {
        Ok(self.clipboard_handle()?.set_text(text)?)
    }
    fn release_all(&mut self) {
        if let Some(input) = &mut self.input {
            for key in self.keys.drain() {
                let _ = input.key(native_key(key), Direction::Release);
            }
            for button in self.buttons.drain() {
                let _ = input.button(native_button(button), Direction::Release);
            }
        }
    }
}

fn direction(down: bool) -> Direction {
    if down {
        Direction::Press
    } else {
        Direction::Release
    }
}
fn native_button(button: PointerButton) -> Button {
    match button {
        PointerButton::Left => Button::Left,
        PointerButton::Right => Button::Right,
        PointerButton::Middle => Button::Middle,
    }
}
fn native_key(key: KeyCode) -> Key {
    match key {
        KeyCode::Letter(c) => Key::Unicode(c.to_ascii_lowercase()),
        KeyCode::Symbol(c) => Key::Unicode(c),
        KeyCode::Digit(n) => Key::Unicode(char::from(b'0' + n)),
        KeyCode::Function(n) => match n {
            1 => Key::F1,
            2 => Key::F2,
            3 => Key::F3,
            4 => Key::F4,
            5 => Key::F5,
            6 => Key::F6,
            7 => Key::F7,
            8 => Key::F8,
            9 => Key::F9,
            10 => Key::F10,
            11 => Key::F11,
            12 => Key::F12,
            _ => unreachable!("V1 function keys are F1 to F12"),
        },
        KeyCode::Control => Key::Control,
        KeyCode::Shift => Key::Shift,
        KeyCode::Alt => Key::Alt,
        KeyCode::Meta => Key::Meta,
        KeyCode::Enter => Key::Return,
        KeyCode::Escape => Key::Escape,
        KeyCode::Backspace => Key::Backspace,
        KeyCode::Tab => Key::Tab,
        KeyCode::Space => Key::Space,
        KeyCode::Delete => Key::Delete,
        #[cfg(target_os = "windows")]
        KeyCode::Insert => Key::Insert,
        #[cfg(target_os = "macos")]
        KeyCode::Insert => Key::Help,
        KeyCode::Home => Key::Home,
        KeyCode::End => Key::End,
        KeyCode::PageUp => Key::PageUp,
        KeyCode::PageDown => Key::PageDown,
        KeyCode::Left => Key::LeftArrow,
        KeyCode::Right => Key::RightArrow,
        KeyCode::Up => Key::UpArrow,
        KeyCode::Down => Key::DownArrow,
    }
}
