use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const ALPN: &[u8] = b"rust-remote-office/1";
pub const CONTROL_LIMIT: usize = 64 * 1024;
pub const FRAME_LIMIT: usize = 72 * 1024 * 1024;
pub const TEXT_LIMIT: usize = 32 * 1024;
pub const TILE: u32 = 128;
const MAX_PIXELS: u64 = 16_777_216;

// An invite is a bearer credential. Deliberately do not derive Debug or log it.
#[derive(Clone, Serialize, Deserialize)]
pub struct Invite {
    pub address: iroh::EndpointAddr,
    pub token: [u8; 32],
    pub relay: bool,
    pub relay_url: Option<iroh::RelayUrl>,
}

impl Invite {
    pub fn encode(&self) -> Result<String> {
        Ok(format!(
            "rro1:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(self)?)
        ))
    }

    pub fn decode(text: &str) -> Result<Self> {
        ensure!(text.len() <= 16 * 1024, "Invite is too large");
        let text = text
            .trim()
            .strip_prefix("rro1:")
            .context("Invalid invite prefix")?;
        Ok(serde_json::from_slice(&URL_SAFE_NO_PAD.decode(text)?)?)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScreenInfo {
    pub name: String,
    pub platform: String,
    pub width: u32,
    pub height: u32,
    // Input coordinates can be logical points, while the captured image is pixels.
    pub input_x: i32,
    pub input_y: i32,
    pub input_width: u32,
    pub input_height: u32,
}

impl ScreenInfo {
    pub fn byte_len(&self) -> Result<usize> {
        ensure!(self.width > 0 && self.height > 0, "Empty screen");
        ensure!(
            self.width <= 8192 && self.height <= 8192,
            "Screen dimension exceeds 8192"
        );
        let pixels = u64::from(self.width) * u64::from(self.height);
        ensure!(pixels <= MAX_PIXELS, "Screen exceeds 16 megapixels");
        ensure!(
            self.input_width > 0 && self.input_height > 0,
            "Empty input bounds"
        );
        ensure!(
            self.input_width <= 32768 && self.input_height <= 32768,
            "Input bounds too large"
        );
        Ok(pixels as usize * 4)
    }

    pub fn input_position(&self, x: u16, y: u16) -> (i32, i32) {
        let axis = |origin: i32, size: u32, position: u16| {
            origin + (u64::from(position) * u64::from(size - 1) / u64::from(u16::MAX)) as i32
        };
        (
            axis(self.input_x, self.input_width, x),
            axis(self.input_y, self.input_height, y),
        )
    }
}

#[derive(Serialize, Deserialize)]
pub struct Hello {
    pub token: [u8; 32],
    pub name: String,
    pub request_control: bool,
    pub request_files: bool,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Permissions {
    pub control: bool,
    pub files: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopInfo {
    pub screen: ScreenInfo,
    pub displays: Vec<DisplayInfo>,
    pub active_display: usize,
    pub rate: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum HostMessage {
    Accepted {
        desktop: DesktopInfo,
        permissions: Permissions,
    },
    Denied(String),
    Clipboard(String),
    Notice(String),
    CaptureState(CaptureState),
    FileError {
        id: u64,
        name: String,
        message: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct CaptureState {
    pub paused: bool,
    pub display: usize,
    pub rate: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KeyCode {
    Letter(char),
    Symbol(char),
    Digit(u8),
    Function(u8),
    Control,
    Shift,
    Alt,
    Meta,
    Enter,
    Escape,
    Backspace,
    Tab,
    Space,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    Left,
    Right,
    Up,
    Down,
}

impl KeyCode {
    pub fn validate(self) -> Result<()> {
        match self {
            Self::Letter(c) => ensure!(c.is_ascii_alphabetic(), "Invalid shortcut letter"),
            Self::Symbol(c) => ensure!(c.is_ascii_punctuation(), "Invalid shortcut symbol"),
            Self::Digit(n) => ensure!(n < 10, "Invalid digit"),
            Self::Function(n) => ensure!((1..=12).contains(&n), "Invalid function key"),
            _ => (),
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PointerButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum InputEvent {
    Move { x: u16, y: u16 },
    Button { button: PointerButton, down: bool },
    Scroll { x: i32, y: i32 },
    Key { key: KeyCode, down: bool },
    Text(String),
    ReleaseAll,
}

impl InputEvent {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Text(s) => ensure!(s.len() <= TEXT_LIMIT, "Text too large"),
            Self::Key { key, .. } => key.validate()?,
            Self::Scroll { x, y } => ensure!(
                x.unsigned_abs() <= 100 && y.unsigned_abs() <= 100,
                "Scroll too large"
            ),
            _ => (),
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ClientMessage {
    Input(InputEvent),
    SetClipboard(String),
    GetClipboard,
    Disconnect,
    FrameAck(u64),
    Pause(bool),
    SelectDisplay(usize),
    SetUpdateRate(u32),
    RequestFile { id: u64, path: String },
}

impl ClientMessage {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Input(e) => e.validate()?,
            Self::SetClipboard(s) => ensure!(s.len() <= TEXT_LIMIT, "Clipboard text too large"),
            Self::SetUpdateRate(fps) => ensure!(
                (1..=60).contains(fps),
                "Update rate must be between 1 and 60"
            ),
            _ => (),
        }
        Ok(())
    }
}

pub async fn write_message<W: AsyncWrite + Unpin, T: Serialize>(
    writer: &mut W,
    message: &T,
    limit: usize,
) -> Result<usize> {
    let data = postcard::to_stdvec(message)?;
    ensure!(
        !data.is_empty() && data.len() <= limit,
        "Outgoing message exceeds size limit"
    );
    writer.write_u32(data.len() as u32).await?;
    writer.write_all(&data).await?;
    Ok(data.len() + 4)
}

pub async fn read_message<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
    limit: usize,
) -> Result<T> {
    Ok(read_message_counted(reader, limit).await?.0)
}

pub async fn read_message_counted<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
    limit: usize,
) -> Result<(T, usize)> {
    let len = reader.read_u32().await? as usize;
    ensure!(
        len > 0 && len <= limit,
        "Incoming message exceeds size limit"
    );
    let mut data = vec![0; len];
    reader.read_exact(&mut data).await?;
    let (message, trailing) = postcard::take_from_bytes(&data)?;
    ensure!(trailing.is_empty(), "Trailing message bytes");
    Ok((message, len + 4))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TileUpdate {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FrameDelta {
    pub sequence: u64,
    pub screen: ScreenInfo,
    pub reset: bool,
    pub tiles: Vec<TileUpdate>,
}

#[derive(Default)]
pub struct FrameEncoder {
    previous: Vec<u8>,
    screen: Option<ScreenInfo>,
    sequence: u64,
}

impl FrameEncoder {
    pub fn encode(&mut self, screen: &ScreenInfo, rgba: &[u8]) -> Result<Option<FrameDelta>> {
        ensure!(rgba.len() == screen.byte_len()?, "Invalid capture buffer");
        let reset = self.screen.as_ref() != Some(screen);
        let mut tiles = Vec::new();
        let stride = screen.width as usize * 4;
        for y in (0..screen.height).step_by(TILE as usize) {
            for x in (0..screen.width).step_by(TILE as usize) {
                let width = TILE.min(screen.width - x);
                let height = TILE.min(screen.height - y);
                let ranges = || {
                    (y..y + height).map(|row| {
                        let start = row as usize * stride + x as usize * 4;
                        start..start + width as usize * 4
                    })
                };
                if !reset && ranges().all(|r| rgba[r.clone()] == self.previous[r]) {
                    continue;
                }
                let mut raw = Vec::with_capacity((width * height * 4) as usize);
                for r in ranges() {
                    raw.extend_from_slice(&rgba[r]);
                }
                tiles.push(TileUpdate {
                    x,
                    y,
                    width,
                    height,
                    data: zstd::bulk::compress(&raw, 1)?,
                });
            }
        }
        if tiles.is_empty() {
            return Ok(None);
        }
        self.previous.clear();
        self.previous.extend_from_slice(rgba);
        self.screen = Some(screen.clone());
        self.sequence += 1;
        Ok(Some(FrameDelta {
            sequence: self.sequence,
            screen: screen.clone(),
            reset,
            tiles,
        }))
    }
}

#[derive(Default)]
pub struct Canvas {
    pub screen: Option<ScreenInfo>,
    pub rgba: Vec<u8>,
    sequence: u64,
}

impl Canvas {
    pub fn apply(&mut self, frame: FrameDelta) -> Result<()> {
        let size = frame.screen.byte_len()?;
        if !frame.reset {
            ensure!(
                self.screen.as_ref() == Some(&frame.screen),
                "Screen metadata changed without reset"
            );
            ensure!(
                frame.sequence == self.sequence + 1,
                "Missing or reordered frame update"
            );
        }
        let tile_count = frame.screen.width.div_ceil(TILE) * frame.screen.height.div_ceil(TILE);
        ensure!(frame.tiles.len() <= tile_count as usize, "Too many tiles");
        if frame.reset {
            ensure!(
                frame.tiles.len() == tile_count as usize,
                "Incomplete initial screen"
            );
        }
        let mut seen = std::collections::HashSet::new();
        let mut decoded = Vec::with_capacity(frame.tiles.len());
        for tile in &frame.tiles {
            ensure!(
                tile.x < frame.screen.width && tile.y < frame.screen.height,
                "Tile outside screen"
            );
            ensure!(tile.x % TILE == 0 && tile.y % TILE == 0, "Unaligned tile");
            ensure!(seen.insert((tile.x, tile.y)), "Duplicate tile");
            ensure!(
                tile.width == TILE.min(frame.screen.width - tile.x)
                    && tile.height == TILE.min(frame.screen.height - tile.y),
                "Invalid tile dimensions"
            );
            ensure!(
                tile.data.len() <= (TILE * TILE * 4 + 1024) as usize,
                "Compressed tile too large"
            );
            let expected = (tile.width * tile.height * 4) as usize;
            let raw = zstd::bulk::decompress(&tile.data, expected)?;
            ensure!(raw.len() == expected, "Invalid decompressed tile");
            decoded.push(raw);
        }
        if frame.reset {
            self.rgba = vec![0; size];
        }
        let stride = frame.screen.width as usize * 4;
        for (tile, raw) in frame.tiles.iter().zip(decoded) {
            let row_bytes = tile.width as usize * 4;
            for row in 0..tile.height as usize {
                let start = (tile.y as usize + row) * stride + tile.x as usize * 4;
                self.rgba[start..start + row_bytes]
                    .copy_from_slice(&raw[row * row_bytes..(row + 1) * row_bytes]);
            }
        }
        self.screen = Some(frame.screen);
        self.sequence = frame.sequence;
        Ok(())
    }
}

pub fn validate_hello(hello: &Hello, token: &[u8; 32], expired: bool) -> Result<()> {
    use subtle::ConstantTimeEq;
    if expired || !bool::from(hello.token.ct_eq(token)) {
        bail!("Invalid or expired invite");
    }
    ensure!(
        !hello.name.is_empty()
            && hello.name.len() <= 80
            && !hello.name.chars().any(char::is_control),
        "Invalid device name"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn screen() -> ScreenInfo {
        ScreenInfo {
            name: "Test".into(),
            platform: "test".into(),
            width: 257,
            height: 129,
            input_x: -1920,
            input_y: 0,
            input_width: 1920,
            input_height: 1080,
        }
    }

    #[test]
    fn lossless_delta_reconstructs_edges_and_changes() {
        let info = screen();
        let mut rgba: Vec<u8> = (0..info.byte_len().unwrap())
            .map(|n| (n % 251) as u8)
            .collect();
        let mut encoder = FrameEncoder::default();
        let mut canvas = Canvas::default();
        canvas
            .apply(encoder.encode(&info, &rgba).unwrap().unwrap())
            .unwrap();
        assert_eq!(canvas.rgba, rgba);
        assert!(encoder.encode(&info, &rgba).unwrap().is_none());
        rgba[0] = 42;
        let delta = encoder.encode(&info, &rgba).unwrap().unwrap();
        assert_eq!(delta.tiles.len(), 1);
        canvas.apply(delta).unwrap();
        assert_eq!(canvas.rgba, rgba);
    }

    #[test]
    fn rejects_missing_delta_and_incomplete_reset() {
        let info = screen();
        let rgba = vec![0; info.byte_len().unwrap()];
        let mut frame = FrameEncoder::default()
            .encode(&info, &rgba)
            .unwrap()
            .unwrap();
        frame.tiles.pop();
        assert!(Canvas::default().apply(frame).is_err());
        let delta = FrameDelta {
            sequence: 2,
            screen: info,
            reset: false,
            tiles: vec![],
        };
        assert!(Canvas::default().apply(delta).is_err());
    }

    #[test]
    fn normalized_input_handles_retina_and_negative_monitor_origin() {
        let info = screen();
        assert_eq!(info.input_position(0, 0), (-1920, 0));
        assert_eq!(info.input_position(u16::MAX, u16::MAX), (-1, 1079));
    }

    #[test]
    fn rejects_decompression_overflow_without_modifying_the_canvas() {
        let info = screen();
        let mut rgba = vec![0; info.byte_len().unwrap()];
        let mut encoder = FrameEncoder::default();
        let mut canvas = Canvas::default();
        canvas
            .apply(encoder.encode(&info, &rgba).unwrap().unwrap())
            .unwrap();
        rgba[0] = 1;
        let mut frame = encoder.encode(&info, &rgba).unwrap().unwrap();
        frame.tiles[0].data =
            zstd::bulk::compress(&vec![0; (TILE * TILE * 4 + 1) as usize], 1).unwrap();
        assert!(canvas.apply(frame).is_err());
        assert!(canvas.rgba.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn rejects_bad_tokens_expired_invites_and_oversized_screens() {
        let mut hello = Hello {
            token: [1; 32],
            name: "Mac".into(),
            request_control: true,
            request_files: true,
        };
        assert!(validate_hello(&hello, &[2; 32], false).is_err());
        assert!(validate_hello(&hello, &[1; 32], true).is_err());
        hello.name.push('\n');
        assert!(validate_hello(&hello, &[1; 32], false).is_err());
        let mut info = screen();
        info.width = u32::MAX;
        assert!(info.byte_len().is_err());
    }

    #[tokio::test]
    async fn rejects_oversized_wire_packet_before_allocation() {
        let (mut sender, mut receiver) = tokio::io::duplex(8);
        sender.write_u32(u32::MAX).await.unwrap();
        assert!(
            read_message::<_, ClientMessage>(&mut receiver, CONTROL_LIMIT)
                .await
                .is_err()
        );
    }
}
