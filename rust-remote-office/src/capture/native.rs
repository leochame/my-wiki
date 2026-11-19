use crate::{capture::BackendFactory, protocol::DisplayInfo};
use anyhow::Result;
use std::sync::Arc;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod supported;

pub fn supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

pub fn factory(monitor: usize) -> BackendFactory {
    BackendFactory {
        capture: Arc::new(move || {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                Ok(Box::new(supported::NativeCapture::open(monitor)?))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let _ = monitor;
                anyhow::bail!("Native sharing requires macOS or Windows")
            }
        }),
        input: Arc::new(|| {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                Ok(Box::new(supported::NativeInput::default()))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                anyhow::bail!("Native input requires macOS or Windows")
            }
        }),
    }
}

pub fn monitors() -> Result<Vec<DisplayInfo>> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        supported::display_infos()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        anyhow::bail!("Native display listing requires macOS or Windows")
    }
}
