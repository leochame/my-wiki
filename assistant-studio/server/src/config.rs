use std::{env, path::PathBuf};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub port: u16,
    pub vault_root: PathBuf,
    pub static_dir: PathBuf,
    pub db_path: PathBuf,
    pub python_bin: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // assistant-studio/server -> assistant-studio -> my-wiki (Vault root)
        let default_vault = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let vault_root = env::var_os("MYWIKI_VAULT_ROOT")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or(default_vault);

        let default_static = manifest_dir.join("../web/dist");
        let static_dir = env::var_os("MYWIKI_STATIC_DIR")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or(default_static);

        let db_path = env::var_os("MYWIKI_DATABASE_PATH")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_db_path);

        let port = env::var("MYWIKI_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8790);

        let venv_py = vault_root.join(".venv/bin/python");
        let python_bin = env::var_os("MYWIKI_PYTHON")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if venv_py.exists() {
                    venv_py
                } else {
                    PathBuf::from("python3")
                }
            });

        Self {
            port,
            vault_root,
            static_dir,
            db_path,
            python_bin,
        }
    }
}

pub fn default_db_path() -> PathBuf {
    let root = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(env::temp_dir)
                .join(".local/share")
        });
    root.join("my-wiki-assistant/assistant.sqlite3")
}

pub fn find_binary(name: &str, env_override: Option<&str>) -> Option<PathBuf> {
    if let Some(var) = env_override {
        if let Some(p) = env::var_os(var).filter(|v| !v.is_empty()) {
            let pb = PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    if let Some(home) = env::var_os("HOME") {
        for rel in [".local/bin", ".npm-global/bin", ".cargo/bin"] {
            let candidate = PathBuf::from(&home).join(rel).join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}
