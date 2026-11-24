use std::{fs, path::Path};

use axum::http::StatusCode;
use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    db::{Database, TaskRecord},
    vault::{atomic_write, extract_frontmatter, index_single_file, slugify_filename},
    ApiError,
};

#[derive(Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    #[serde(default = "default_source")]
    pub source: String, // by_task | todo
    #[serde(default = "default_status")]
    pub status: String,
    pub due: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub priority: Option<String>,
    pub category: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct PromoteTaskRequest {
    pub due: String,
    pub priority: Option<String>,
}

fn default_source() -> String {
    "by_task".into()
}
fn default_status() -> String {
    "todo".into()
}
fn default_priority() -> String {
    "medium".into()
}

fn normalize_status(raw: &str) -> Result<String, ApiError> {
    let s = raw.trim().to_lowercase().replace(' ', "-");
    match s.as_str() {
        "todo" | "in-progress" | "waiting" | "done" | "cancelled" => Ok(s),
        _ => Err(ApiError(
            StatusCode::BAD_REQUEST,
            "状态仅支持 todo / in-progress / waiting / done / cancelled".into(),
        )),
    }
}

fn normalize_priority(raw: &str) -> Result<String, ApiError> {
    let p = raw.trim().to_lowercase();
    match p.as_str() {
        "low" | "medium" | "high" | "urgent" => Ok(p),
        _ => Err(ApiError(
            StatusCode::BAD_REQUEST,
            "优先级仅支持 low / medium / high / urgent".into(),
        )),
    }
}

fn status_display_todo(status: &str) -> &'static str {
    match status {
        "in-progress" => "In Progress",
        "waiting" => "Waiting",
        "done" => "Done",
        "cancelled" => "Cancelled",
        _ => "Todo",
    }
}

fn priority_display_todo(priority: &str) -> &'static str {
    match priority {
        "urgent" | "high" => "High",
        "low" => "Low",
        _ => "Medium",
    }
}

pub fn scan_tasks_from_vault(vault_root: &Path) -> Vec<TaskRecord> {
    let mut out = Vec::new();
    let now = Utc::now().to_rfc3339();

    // 1. Scan task/by-task/*.md
    let by_task_dir = vault_root.join("task/by-task");
    if let Ok(entries) = fs::read_dir(&by_task_dir) {
        let mut files: Vec<_> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
            .collect();
        files.sort();
        for path in files {
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let (fm, _) = extract_frontmatter(&content);
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            let id = fm
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| stem.clone());
            let title = fm
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| stem.clone());
            let status = fm
                .get("status")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_lowercase().replace(' ', "-"))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "todo".into());
            let due = fm
                .get("due")
                .and_then(|v| match v {
                    Value::String(s) => Some(s.trim().to_string()),
                    _ => None,
                })
                .filter(|s| !s.is_empty());
            let priority = fm
                .get("priority")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "medium".into());
            let category = fm
                .get("category")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            let watch = fm
                .get("watch")
                .and_then(Value::as_str)
                .map(|w| format!("watch:{w}"))
                .unwrap_or_default();
            let rel_path = path
                .strip_prefix(vault_root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| format!("task/by-task/{stem}.md"));

            out.push(TaskRecord {
                id,
                source: "by_task".into(),
                file_path: rel_path,
                title,
                status,
                due,
                priority,
                category,
                notes: watch,
                updated_at: now.clone(),
            });
        }
    }

    // 2. Parse task/TODO.md Markdown table
    let todo_path = vault_root.join("task/TODO.md");
    if let Ok(content) = fs::read_to_string(&todo_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('|') || !trimmed.ends_with('|') {
                continue;
            }
            let cells: Vec<&str> = trimmed
                .trim_matches('|')
                .split('|')
                .map(str::trim)
                .collect();
            if cells.len() < 5 {
                continue;
            }
            let id = cells[0];
            if id.eq_ignore_ascii_case("ID")
                || id.chars().all(|c| c == '-' || c == ':')
                || !id.starts_with("NT-")
            {
                continue;
            }
            let title = cells[1].to_string();
            let category = cells[2].to_string();
            let status = cells[3].to_lowercase().replace(' ', "-");
            let priority = cells[4].to_lowercase();
            let notes = cells.get(5).copied().unwrap_or("").to_string();

            out.push(TaskRecord {
                id: id.to_string(),
                source: "todo".into(),
                file_path: "task/TODO.md".into(),
                title,
                status,
                due: None,
                priority,
                category,
                notes,
                updated_at: now.clone(),
            });
        }
    }

    out
}

pub async fn sync_tasks_to_db(vault_root: &Path, db: &Database) -> Result<Vec<TaskRecord>, ApiError> {
    let root = vault_root.to_path_buf();
    let tasks = tokio::task::spawn_blocking(move || scan_tasks_from_vault(&root))
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("扫描任务失败: {e}")))?;
    db.replace_tasks(tasks).await?;
    db.list_tasks().await
}

fn next_id(existing: &[TaskRecord], prefix: &str) -> String {
    let max_num = existing
        .iter()
        .filter_map(|t| t.id.strip_prefix(prefix))
        .filter_map(|s| s.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("{prefix}{:03}", max_num + 1)
}

pub async fn create_task(
    vault_root: &Path,
    db: &Database,
    req: CreateTaskRequest,
) -> Result<TaskRecord, ApiError> {
    let title = req.title.trim();
    if title.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "任务标题不能为空".into()));
    }
    let status = normalize_status(&req.status)?;
    let priority = normalize_priority(&req.priority)?;
    let existing = sync_tasks_to_db(vault_root, db).await?;

    if req.source == "todo" {
        let id = next_id(&existing, "NT-");
        let todo_path = vault_root.join("task/TODO.md");
        let mut content = fs::read_to_string(&todo_path).unwrap_or_else(|_| {
            "## Non-Deadline Todo List\n\n| ID | Task | Category | Status | Priority | Notes |\n| --- | --- | --- | --- | --- | --- |\n".into()
        });
        let safe = |s: &str| s.replace('|', "｜").replace('\n', " ");
        let cat = if req.category.trim().is_empty() {
            "Personal"
        } else {
            req.category.trim()
        };
        let row = format!(
            "| {id} | {} | {} | {} | {} | {} |\n",
            safe(title),
            safe(cat),
            status_display_todo(&status),
            priority_display_todo(&priority),
            safe(req.notes.trim())
        );
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&row);
        atomic_write(&todo_path, &content)?;
        let _ = index_single_file(vault_root, db, "task/TODO.md").await;
        sync_tasks_to_db(vault_root, db).await?;
        return db
            .get_task(id)
            .await?
            .ok_or_else(|| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "新建待办回读失败".into()));
    }

    let id = next_id(&existing, "T-");
    let slug = slugify_filename(title);
    let rel_path = format!("task/by-task/{id}-{slug}.md");
    let abs_path = vault_root.join(&rel_path);

    let mut fm = vec![
        "---".to_string(),
        format!("id: {id}"),
        format!("title: {title}"),
        format!("status: {status}"),
    ];
    if let Some(due) = req.due.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        fm.push(format!("due: {due}"));
    }
    fm.push(format!("priority: {priority}"));
    if !req.category.trim().is_empty() {
        fm.push(format!("category: {}", req.category.trim()));
    }
    fm.push("---".into());

    let desc = if req.description.trim().is_empty() {
        title
    } else {
        req.description.trim()
    };
    let doc = format!(
        "{}\n\n## Description\n\n{desc}\n\n## Next Actions\n\n- [ ] 待细化下一步行动\n",
        fm.join("\n")
    );
    atomic_write(&abs_path, &doc)?;
    let _ = index_single_file(vault_root, db, &rel_path).await;
    sync_tasks_to_db(vault_root, db).await?;
    db.get_task(id)
        .await?
        .ok_or_else(|| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "新建任务回读失败".into()))
}

/// Surgically updates YAML front matter keys while preserving inline comments & entire Markdown body.
pub fn patch_frontmatter_keys(content: &str, patches: &[(&str, String)]) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return content.to_string();
    }
    let Some(end_idx) = lines.iter().skip(1).position(|l| l.trim() == "---").map(|i| i + 1) else {
        return content.to_string();
    };

    let mut fm_lines: Vec<String> = lines[1..end_idx].iter().map(|s| (*s).to_string()).collect();
    for (key, val) in patches {
        let prefix = format!("{key}:");
        if let Some(line) = fm_lines
            .iter_mut()
            .find(|l| l.trim_start().starts_with(&prefix))
        {
            // Preserve trailing inline `# comment` and its leading padding if present
            let comment = line
                .find('#')
                .map(|idx| {
                    let ws_start = line[..idx].trim_end().len();
                    line[ws_start..].to_string()
                })
                .unwrap_or_default();
            if val.is_empty() {
                *line = format!("{key}:");
            } else {
                *line = format!("{key}: {val}{comment}");
            }
        } else if !val.is_empty() {
            fm_lines.push(format!("{key}: {val}"));
        }
    }

    let mut rebuilt = Vec::with_capacity(lines.len() + 2);
    rebuilt.push("---".to_string());
    rebuilt.extend(fm_lines);
    rebuilt.push("---".to_string());
    for line in &lines[end_idx + 1..] {
        rebuilt.push((*line).to_string());
    }
    let mut joined = rebuilt.join("\n");
    if content.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

pub async fn update_task(
    vault_root: &Path,
    db: &Database,
    id: &str,
    req: UpdateTaskRequest,
) -> Result<TaskRecord, ApiError> {
    let existing = db
        .get_task(id.to_string())
        .await?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("未找到任务 {id}")))?;

    let next_status = match req.status.as_deref() {
        Some(s) => Some(normalize_status(s)?),
        None => None,
    };
    let next_priority = match req.priority.as_deref() {
        Some(p) => Some(normalize_priority(p)?),
        None => None,
    };

    if existing.source == "todo" {
        let abs = vault_root.join("task/TODO.md");
        let content = fs::read_to_string(&abs)
            .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("读取 TODO.md 失败: {e}")))?;
        let mut updated_lines = Vec::new();
        let mut found = false;
        let safe = |s: &str| s.replace('|', "｜").replace('\n', " ");

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('|') && trimmed.ends_with('|') {
                let cells: Vec<&str> = trimmed.trim_matches('|').split('|').map(str::trim).collect();
                if cells.len() >= 5 && cells[0] == id {
                    found = true;
                    let title = req.title.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(cells[1]);
                    let cat = req.category.as_deref().map(str::trim).unwrap_or(cells[2]);
                    let st = next_status
                        .as_deref()
                        .map(status_display_todo)
                        .unwrap_or(cells[3]);
                    let pr = next_priority
                        .as_deref()
                        .map(priority_display_todo)
                        .unwrap_or(cells[4]);
                    let notes = req
                        .notes
                        .as_deref()
                        .map(str::trim)
                        .unwrap_or_else(|| cells.get(5).copied().unwrap_or(""));
                    updated_lines.push(format!(
                        "| {id} | {} | {} | {st} | {pr} | {} |",
                        safe(title),
                        safe(cat),
                        safe(notes)
                    ));
                    continue;
                }
            }
            updated_lines.push(line.to_string());
        }
        if !found {
            return Err(ApiError(StatusCode::NOT_FOUND, format!("TODO.md 中未找到 {id}")));
        }
        let mut out = updated_lines.join("\n");
        if content.ends_with('\n') {
            out.push('\n');
        }
        atomic_write(&abs, &out)?;
        let _ = index_single_file(vault_root, db, "task/TODO.md").await;
    } else {
        let abs = vault_root.join(&existing.file_path);
        let content = fs::read_to_string(&abs)
            .map_err(|e| ApiError(StatusCode::NOT_FOUND, format!("读取任务文件失败: {e}")))?;
        let mut patches: Vec<(&str, String)> = Vec::new();
        if let Some(t) = req.title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            patches.push(("title", t.to_string()));
        }
        if let Some(s) = next_status {
            patches.push(("status", s));
        }
        if let Some(d) = req.due {
            patches.push(("due", d.trim().to_string()));
        }
        if let Some(p) = next_priority {
            patches.push(("priority", p));
        }
        if let Some(c) = req.category {
            patches.push(("category", c.trim().to_string()));
        }
        let patched = patch_frontmatter_keys(&content, &patches);
        atomic_write(&abs, &patched)?;
        let _ = index_single_file(vault_root, db, &existing.file_path).await;
    }

    sync_tasks_to_db(vault_root, db).await?;
    db.get_task(id.to_string())
        .await?
        .ok_or_else(|| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "任务更新后回读失败".into()))
}

pub async fn promote_todo_to_task(
    vault_root: &Path,
    db: &Database,
    id: &str,
    req: PromoteTaskRequest,
) -> Result<TaskRecord, ApiError> {
    let existing = db
        .get_task(id.to_string())
        .await?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("未找到待办 {id}")))?;
    if existing.source != "todo" {
        return Err(ApiError(StatusCode::BAD_REQUEST, "该任务已是独立期限任务".into()));
    }
    let created = create_task(
        vault_root,
        db,
        CreateTaskRequest {
            title: existing.title.clone(),
            source: "by_task".into(),
            status: if existing.status == "done" {
                "done".into()
            } else {
                "todo".into()
            },
            due: Some(req.due.trim().to_string()),
            priority: req.priority.unwrap_or(existing.priority),
            category: existing.category,
            notes: String::new(),
            description: existing.notes,
        },
    )
    .await?;

    // Mark original NT-* row in TODO.md as Done with reference to new T-xxx ID
    let _ = update_task(
        vault_root,
        db,
        id,
        UpdateTaskRequest {
            title: None,
            status: Some("done".into()),
            due: None,
            priority: None,
            category: None,
            notes: Some(format!("已转为 {}", created.id)),
        },
    )
    .await;

    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_yaml_preserving_comments_and_body() {
        let raw = "---\nid: T-038\ntitle: WHV\nstatus: waiting         # todo | done\ndue: 2027-01-15\npriority: high\n---\n\n## Description\n\nKeep [[Home]] untouched.\n";
        let out = patch_frontmatter_keys(raw, &[("status", "in-progress".into())]);
        assert!(out.contains("status: in-progress         # todo | done"));
        assert!(out.contains("Keep [[Home]] untouched."));
    }
}
