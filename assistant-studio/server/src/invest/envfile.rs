use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct EnvLoadReport {
    pub path: PathBuf,
    pub loaded: bool,
    pub applied_keys: usize,
}

pub fn default_config_dir() -> PathBuf {
    if let Some(dir) = env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(dir).join("northstar");
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join(".config")
        .join("northstar")
}

pub fn default_env_path() -> PathBuf {
    if let Some(path) = env::var_os("NORTHSTAR_ENV_FILE").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    default_config_dir().join("runtime.env")
}

/// Parses KEY=VALUE lines from an env file. Comments and empty lines are skipped.
pub fn parse_env_content(content: &str) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map(str::trim).unwrap_or(line);
        let Some((raw_key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if key.is_empty()
            || !key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            continue;
        }
        let value = unquote(raw_value.trim());
        entries.push((key.to_string(), value));
    }
    entries
}

fn unquote(raw: &str) -> String {
    if raw.len() >= 2
        && ((raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\'')))
    {
        return raw[1..raw.len() - 1].to_string();
    }
    // Strip trailing inline comment for unquoted values (`VALUE # comment`).
    if let Some((before, _)) = raw.split_once(" #") {
        return before.trim().to_string();
    }
    raw.to_string()
}

/// Loads variables from an external runtime env file without overwriting
/// variables already provided by the calling shell environment.
pub fn load_external_env(path: &Path) -> EnvLoadReport {
    let Ok(content) = fs::read_to_string(path) else {
        return EnvLoadReport {
            path: path.to_path_buf(),
            loaded: false,
            applied_keys: 0,
        };
    };
    let mut applied = 0usize;
    for (key, value) in parse_env_content(&content) {
        if value.is_empty() {
            continue;
        }
        let already_set = env::var(&key).ok().is_some_and(|existing| !existing.is_empty());
        if !already_set {
            // SAFETY: Called once at process startup before spawning background worker threads.
            unsafe {
                env::set_var(&key, &value);
            }
            applied += 1;
        }
    }
    EnvLoadReport {
        path: path.to_path_buf(),
        loaded: true,
        applied_keys: applied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_and_quoted_env_entries() {
        let input = r#"
            # Comment line
            APP_ENV=development
            export LONGBRIDGE_APP_KEY="my-app-key"
            LONGBRIDGE_APP_SECRET='my-app-secret'
            PORT=8787 # inline comment
            EMPTY_VAL=
            INVALID KEY=value
        "#;
        let parsed = parse_env_content(input);
        assert_eq!(
            parsed,
            vec![
                ("APP_ENV".into(), "development".into()),
                ("LONGBRIDGE_APP_KEY".into(), "my-app-key".into()),
                ("LONGBRIDGE_APP_SECRET".into(), "my-app-secret".into()),
                ("PORT".into(), "8787".into()),
                ("EMPTY_VAL".into(), "".into()),
            ]
        );
    }
}
