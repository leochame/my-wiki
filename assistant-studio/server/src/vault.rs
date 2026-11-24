use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use axum::http::StatusCode;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    db::{Database, VaultFileRecord, WikilinkRecord},
    ApiError,
};

const IGNORED_TOP_DIRS: &[&str] = &[
    ".git",
    ".obsidian",
    ".agentero",
    ".agents",
    ".claude",
    ".cursor",
    ".github",
    ".idea",
    ".venv",
    "node_modules",
    "target",
    "trading-platform",
    "assistant-studio",
    "rust-remote-office",
    "meituan-wechat-bridge",
    "ai-infra-lab",
    "leochame.github.io",
];

#[derive(Clone, Debug, Serialize)]
pub struct VaultFileDetail {
    pub path: String,
    pub area: String,
    pub title: String,
    pub content: String,
    pub frontmatter: Value,
    pub tags: Vec<String>,
    pub word_count: usize,
    pub mtime: i64,
    pub outgoing: Vec<WikilinkRecord>,
    pub backlinks: Vec<WikilinkRecord>,
}

#[derive(Deserialize)]
pub struct SaveFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct CreateFileRequest {
    pub folder: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub body: String,
}

pub fn area_of(rel: &str) -> String {
    match rel.split('/').next().unwrap_or("") {
        "task" => "task",
        "writing" => "writing",
        "worth-reading" => "worth-reading",
        "notes" => "notes",
        "career-development" => "career-development",
        "memory" => "memory",
        "papers" => "papers",
        "investment" => "investment",
        _ => "root",
    }
    .into()
}

pub fn validate_rel_path(raw: &str) -> Result<String, ApiError> {
    let trimmed = raw.trim().replace('\\', "/");
    if trimmed.is_empty() || trimmed.starts_with('/') {
        return Err(ApiError(StatusCode::BAD_REQUEST, "无效的 Vault 文件路径".into()));
    }
    let pb = Path::new(&trimmed);
    for comp in pb.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err(ApiError(StatusCode::BAD_REQUEST, "路径不可包含 .. 或绝对前缀".into())),
        }
    }
    let top = trimmed.split('/').next().unwrap_or("");
    if IGNORED_TOP_DIRS.contains(&top) {
        return Err(ApiError(StatusCode::FORBIDDEN, "禁止修改受保护的系统或子项目目录".into()));
    }
    if trimmed.starts_with("papers/") && trimmed.contains("/source/") {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "遵循 Vault 规范，禁止修改 papers/**/source/ 原始文件".into(),
        ));
    }
    if !trimmed.ends_with(".md") {
        return Err(ApiError(StatusCode::BAD_REQUEST, "仅支持读写 Markdown (.md) 文档".into()));
    }
    Ok(trimmed)
}

pub fn validate_folder(raw: &str) -> Result<String, ApiError> {
    let trimmed = raw.trim().trim_matches('/').replace('\\', "/");
    if trimmed.is_empty() {
        return Ok("notes".into());
    }
    let pb = Path::new(&trimmed);
    for comp in pb.components() {
        if !matches!(comp, Component::Normal(_)) {
            return Err(ApiError(StatusCode::BAD_REQUEST, "无效的目标目录".into()));
        }
    }
    let top = trimmed.split('/').next().unwrap_or("");
    if IGNORED_TOP_DIRS.contains(&top) {
        return Err(ApiError(StatusCode::FORBIDDEN, "禁止在系统目录中创建文档".into()));
    }
    Ok(trimmed)
}

pub fn atomic_write(abs_path: &Path, content: &str) -> Result<(), ApiError> {
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("创建目录失败: {e}"),
            )
        })?;
    }
    let tmp = abs_path.with_extension(format!("md.tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, content).map_err(|e| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("写入临时文件失败: {e}"),
        )
    })?;
    fs::rename(&tmp, abs_path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("原子保存失败: {e}"))
    })?;
    Ok(())
}

pub fn extract_frontmatter(content: &str) -> (Value, &str) {
    let normalized = content.strip_prefix('\u{feff}').unwrap_or(content);
    let Some(rest) = normalized
        .strip_prefix("---\n")
        .or_else(|| normalized.strip_prefix("---\r\n"))
    else {
        return (json!({}), normalized);
    };
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == "---" || trimmed == "..." {
            let yaml_str = &rest[..offset];
            let body = &rest[offset + line.len()..];
            let parsed = serde_yaml::from_str::<Value>(yaml_str).unwrap_or_else(|_| json!({}));
            return (parsed, body);
        }
        offset += line.len();
    }
    (json!({}), normalized)
}

pub fn extract_title(rel_path: &str, frontmatter: &Value, body: &str) -> String {
    if let Some(t) = frontmatter
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return t.to_string();
    }
    for line in body.lines().take(25) {
        let t = line.trim();
        if let Some(h) = t.strip_prefix("# ") {
            let clean = h.trim();
            if !clean.is_empty() {
                return clean.to_string();
            }
        }
    }
    Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel_path)
        .to_string()
}

pub fn extract_tags(frontmatter: &Value) -> Vec<String> {
    let mut tags = Vec::new();
    match frontmatter.get("tags") {
        Some(Value::Array(arr)) => {
            for item in arr {
                if let Some(s) = item.as_str() {
                    let clean = s.trim().trim_start_matches('#');
                    if !clean.is_empty() {
                        tags.push(clean.to_string());
                    }
                }
            }
        }
        Some(Value::String(s)) => {
            for part in s.split([',', ' ']) {
                let clean = part.trim().trim_start_matches('#');
                if !clean.is_empty() {
                    tags.push(clean.to_string());
                }
            }
        }
        _ => {}
    }
    tags
}

pub fn extract_wikilinks(content: &str) -> Vec<(String, Option<String>)> {
    let mut links = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(end_rel) = content[i + 2..].find("]]") {
                let inner = content[i + 2..i + 2 + end_rel].trim();
                if !inner.is_empty() && !inner.contains('\n') && inner.len() <= 240 {
                    let (target, alias) = match inner.split_once('|') {
                        Some((t, a)) => (t.trim(), Some(a.trim().to_string())),
                        None => (inner, None),
                    };
                    let target_clean = target.split('#').next().unwrap_or(target).trim();
                    if !target_clean.is_empty() {
                        links.push((target_clean.to_string(), alias));
                    }
                }
                i += 2 + end_rel + 2;
                continue;
            }
        }
        i += 1;
    }
    links
}

fn hash_text(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn collect_markdown_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if name.starts_with('.') {
                continue;
            }
            if dir == root && IGNORED_TOP_DIRS.contains(&name) {
                continue;
            }
            if name == "node_modules" || name == "target" || name == "__pycache__" {
                continue;
            }
        }
        if rel_str.starts_with("papers/") && rel_str.contains("/source") {
            continue;
        }
        if path.is_dir() {
            collect_markdown_files(root, &path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
            out.push(path);
        }
    }
}

fn build_resolution_map(paths: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for p in paths {
        let no_ext = p.strip_suffix(".md").unwrap_or(p);
        map.insert(p.to_lowercase(), p.clone());
        map.insert(no_ext.to_lowercase(), p.clone());
        if let Some(stem) = Path::new(p).file_stem().and_then(|s| s.to_str()) {
            map.entry(stem.to_lowercase()).or_insert_with(|| p.clone());
        }
    }
    map
}

fn resolve_target(target: &str, lookup: &HashMap<String, String>) -> Option<String> {
    let normalized = target.trim().trim_start_matches('/').to_lowercase();
    lookup
        .get(&normalized)
        .or_else(|| lookup.get(&format!("{normalized}.md")))
        .cloned()
}

pub async fn full_reindex(vault_root: &Path, db: &Database) -> Result<usize, ApiError> {
    let root = vault_root.to_path_buf();
    let scanned = tokio::task::spawn_blocking(move || {
        let mut abs_files = Vec::new();
        collect_markdown_files(&root, &root, &mut abs_files);

        let mut rel_paths = Vec::with_capacity(abs_files.len());
        let mut raw_entries = Vec::with_capacity(abs_files.len());

        for abs in abs_files {
            let Ok(rel) = abs.strip_prefix(&root) else {
                continue;
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let Ok(content) = fs::read_to_string(&abs) else {
                continue;
            };
            let mtime = fs::metadata(&abs)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            rel_paths.push(rel_str.clone());
            raw_entries.push((rel_str, content, mtime));
        }

        let lookup = build_resolution_map(&rel_paths);
        let now = Utc::now().to_rfc3339();
        let mut out = Vec::with_capacity(raw_entries.len());

        for (rel_str, content, mtime) in raw_entries {
            let (fm, body) = extract_frontmatter(&content);
            let title = extract_title(&rel_str, &fm, body);
            let tags = extract_tags(&fm);
            let word_count = body.chars().filter(|c| !c.is_whitespace()).count();
            let rec = VaultFileRecord {
                path: rel_str.clone(),
                area: area_of(&rel_str),
                title,
                frontmatter_json: serde_json::to_string(&fm).unwrap_or_else(|_| "{}".into()),
                tags,
                word_count,
                mtime,
                content_hash: hash_text(&content),
                indexed_at: now.clone(),
            };
            let links = extract_wikilinks(&content)
                .into_iter()
                .map(|(target_raw, alias)| WikilinkRecord {
                    source_path: rel_str.clone(),
                    resolved_path: resolve_target(&target_raw, &lookup),
                    target_raw,
                    alias,
                })
                .collect();
            out.push((rec, body.to_string(), links));
        }
        out
    })
    .await
    .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("扫描 Vault 失败: {e}")))?;

    db.replace_vault_index(scanned).await
}

pub async fn index_single_file(vault_root: &Path, db: &Database, rel_path: &str) -> Result<(), ApiError> {
    let abs = vault_root.join(rel_path);
    let content = fs::read_to_string(&abs)
        .map_err(|e| ApiError(StatusCode::NOT_FOUND, format!("读取文件失败: {e}")))?;
    let mtime = fs::metadata(&abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let all_files = db.list_vault_files(None).await?;
    let mut all_paths: Vec<String> = all_files.into_iter().map(|f| f.path).collect();
    if !all_paths.iter().any(|p| p == rel_path) {
        all_paths.push(rel_path.to_string());
    }
    let lookup = build_resolution_map(&all_paths);

    let (fm, body) = extract_frontmatter(&content);
    let title = extract_title(rel_path, &fm, body);
    let tags = extract_tags(&fm);
    let word_count = body.chars().filter(|c| !c.is_whitespace()).count();
    let rec = VaultFileRecord {
        path: rel_path.to_string(),
        area: area_of(rel_path),
        title,
        frontmatter_json: serde_json::to_string(&fm).unwrap_or_else(|_| "{}".into()),
        tags,
        word_count,
        mtime,
        content_hash: hash_text(&content),
        indexed_at: Utc::now().to_rfc3339(),
    };
    let links = extract_wikilinks(&content)
        .into_iter()
        .map(|(target_raw, alias)| WikilinkRecord {
            source_path: rel_path.to_string(),
            resolved_path: resolve_target(&target_raw, &lookup),
            target_raw,
            alias,
        })
        .collect();
    db.upsert_vault_file(rec, body.to_string(), links).await
}

pub async fn read_file_detail(
    vault_root: &Path,
    db: &Database,
    raw_path: &str,
) -> Result<VaultFileDetail, ApiError> {
    let rel = validate_rel_path(raw_path)?;
    let abs = vault_root.join(&rel);
    let content = fs::read_to_string(&abs)
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, format!("文件不存在: {rel}")))?;
    let mtime = fs::metadata(&abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (fm, body) = extract_frontmatter(&content);
    let title = extract_title(&rel, &fm, body);
    let tags = extract_tags(&fm);
    let word_count = body.chars().filter(|c| !c.is_whitespace()).count();
    let (outgoing, backlinks) = db.links_for_file(rel.clone()).await?;
    Ok(VaultFileDetail {
        path: rel.clone(),
        area: area_of(&rel),
        title,
        content,
        frontmatter: fm,
        tags,
        word_count,
        mtime,
        outgoing,
        backlinks,
    })
}

pub fn slugify_filename(title: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in title.trim().chars() {
        if ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            out.push(ch);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("note-{}", Utc::now().format("%Y%m%d-%H%M%S"))
    } else {
        trimmed.chars().take(64).collect()
    }
}

pub async fn create_markdown_file(
    vault_root: &Path,
    db: &Database,
    req: CreateFileRequest,
) -> Result<VaultFileDetail, ApiError> {
    let folder = validate_folder(&req.folder)?;
    let title = req.title.trim();
    if title.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "文档标题不能为空".into()));
    }
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let slug = slugify_filename(title);
    let mut rel = format!("{folder}/{slug}.md");
    if vault_root.join(&rel).exists() {
        rel = format!("{folder}/{slug}-{}.md", Utc::now().format("%H%M%S"));
    }
    let rel = validate_rel_path(&rel)?;

    let mut fm_lines = vec![
        "---".to_string(),
        format!("title: {}", title),
        format!("created: {today}"),
        format!("updated: {today}"),
    ];
    if !req.tags.is_empty() {
        fm_lines.push("tags:".into());
        for tag in &req.tags {
            let clean = tag.trim().trim_start_matches('#');
            if !clean.is_empty() {
                fm_lines.push(format!("  - {clean}"));
            }
        }
    }
    fm_lines.push("---".into());
    let body = if req.body.trim().is_empty() {
        format!("\n# {title}\n\n")
    } else {
        format!("\n# {title}\n\n{}\n", req.body.trim())
    };
    let full = format!("{}\n{}", fm_lines.join("\n"), body.trim_start_matches('\n'));

    atomic_write(&vault_root.join(&rel), &full)?;
    index_single_file(vault_root, db, &rel).await?;
    read_file_detail(vault_root, db, &rel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_paths_and_blocks_protected_dirs() {
        assert!(validate_rel_path("notes/test.md").is_ok());
        assert!(validate_rel_path("../secret.md").is_err());
        assert!(validate_rel_path("trading-platform/README.md").is_err());
        assert!(validate_rel_path("papers/foo/source/main.md").is_err());
        assert!(validate_rel_path("notes/image.png").is_err());
    }

    #[test]
    fn parses_frontmatter_tags_and_wikilinks() {
        let doc = "---\ntitle: 测试笔记\ntags:\n  - AI\n  - 笔记\n---\n\n参考 [[Home|首页]] 与 [[task/today]]。";
        let (fm, body) = extract_frontmatter(doc);
        assert_eq!(extract_title("notes/x.md", &fm, body), "测试笔记");
        assert_eq!(extract_tags(&fm), vec!["AI", "笔记"]);
        let links = extract_wikilinks(doc);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0], ("Home".into(), Some("首页".into())));
        assert_eq!(links[1], ("task/today".into(), None));
    }
}
