use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, Semaphore};
use tracing::{info, warn};

use crate::{db::Database, ApiError};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaSource {
    pub id: String,
    pub name: String,
    pub outlet: String,
    pub category: String,
    pub language: String,
    pub feed_url: String,
    pub site_url: String,
    pub enabled: bool,
    pub added_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaSourceStatus {
    #[serde(flatten)]
    pub source: MediaSource,
    pub ok: bool,
    pub item_count: usize,
    pub error: Option<String>,
    pub fetched_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaItem {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub outlet: String,
    pub category: String,
    pub language: String,
    pub title: String,
    pub url: String,
    pub summary: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaFeedResponse {
    pub updated_at: Option<String>,
    pub refreshing: bool,
    pub sources: Vec<MediaSourceStatus>,
    pub items: Vec<MediaItem>,
}

#[derive(Deserialize)]
pub struct AddMediaSourceRequest {
    pub name: String,
    pub outlet: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default = "default_lang")]
    pub language: String,
    pub feed_url: String,
    #[serde(default)]
    pub site_url: String,
}

#[derive(Deserialize)]
pub struct ToggleMediaSourceRequest {
    pub enabled: bool,
}

fn default_category() -> String {
    "自定义".into()
}

fn default_lang() -> String {
    "en".into()
}

pub fn default_media_sources() -> Vec<MediaSource> {
    let now = Utc::now().to_rfc3339();
    let specs: &[(&str, &str, &str, &str, &str, &str, &str)] = &[
        // 彭博 Bloomberg（notes/理财/财经媒体-关注渠道索引.md）
        (
            "bloomberg-markets",
            "Bloomberg · Markets",
            "Bloomberg",
            "核心媒体",
            "en",
            "https://feeds.bloomberg.com/markets/news.rss",
            "https://www.bloomberg.com/markets",
        ),
        (
            "bloomberg-tech",
            "Bloomberg · Technology",
            "Bloomberg",
            "核心媒体",
            "en",
            "https://feeds.bloomberg.com/technology/news.rss",
            "https://www.bloomberg.com/technology",
        ),
        (
            "bloomberg-econ",
            "Bloomberg · Economics",
            "Bloomberg",
            "核心媒体",
            "en",
            "https://feeds.bloomberg.com/economics/news.rss",
            "https://www.bloomberg.com/economics",
        ),
        (
            "bloomberg-yt",
            "Bloomberg TV (YouTube)",
            "Bloomberg",
            "核心媒体",
            "en",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCIALMKvObZNtJ6AmdCLP7Lg",
            "https://www.youtube.com/@markets",
        ),
        // 路透社 Reuters（notes/理财/财经媒体-关注渠道索引.md）
        (
            "reuters-news",
            "Reuters · 快讯 (Google News RSS)",
            "Reuters",
            "核心媒体",
            "en",
            "https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en",
            "https://www.reuters.com/",
        ),
        (
            "reuters-yt",
            "Reuters (YouTube)",
            "Reuters",
            "核心媒体",
            "en",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ",
            "https://www.youtube.com/@Reuters",
        ),
        // 《华尔街日报》WSJ（notes/理财/财经媒体-关注渠道索引.md）
        (
            "wsj-cn",
            "WSJ 中文网 (Google News RSS)",
            "WSJ",
            "核心媒体",
            "zh",
            "https://news.google.com/rss/search?q=site:cn.wsj.com+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
            "https://cn.wsj.com/",
        ),
        (
            "wsj-markets",
            "WSJ · Markets",
            "WSJ",
            "核心媒体",
            "en",
            "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
            "https://www.wsj.com/finance",
        ),
        (
            "wsj-business",
            "WSJ · US Business",
            "WSJ",
            "核心媒体",
            "en",
            "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness",
            "https://www.wsj.com/business",
        ),
        (
            "wsj-tech",
            "WSJ · Tech",
            "WSJ",
            "核心媒体",
            "en",
            "https://feeds.content.dowjones.io/public/rss/RSSWSJD",
            "https://www.wsj.com/tech",
        ),
        // 《纽约时报》NYT（notes/理财/财经媒体-关注渠道索引.md）
        (
            "nyt-cn",
            "NYT 中文网",
            "NYT",
            "核心媒体",
            "zh",
            "https://cn.nytimes.com/rss/",
            "https://cn.nytimes.com/",
        ),
        (
            "nyt-business",
            "NYT · Business",
            "NYT",
            "核心媒体",
            "en",
            "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
            "https://www.nytimes.com/section/business",
        ),
        (
            "nyt-economy",
            "NYT · Economy",
            "NYT",
            "核心媒体",
            "en",
            "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
            "https://www.nytimes.com/section/business/economy",
        ),
        (
            "nyt-tech",
            "NYT · Technology",
            "NYT",
            "核心媒体",
            "en",
            "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
            "https://www.nytimes.com/section/technology",
        ),
        // 海外财经跟踪规则：FT / AP / Fed / SEC（notes/理财/海外财经跟踪规则.md）
        (
            "ft-markets",
            "Financial Times · Markets",
            "FT",
            "财经与监管",
            "en",
            "https://www.ft.com/markets?format=rss",
            "https://www.ft.com/markets",
        ),
        (
            "ap-business",
            "AP News · Business (Google News RSS)",
            "AP",
            "财经与监管",
            "en",
            "https://news.google.com/rss/search?q=site:apnews.com+business+OR+markets+when:3d&hl=en-US&gl=US&ceid=US:en",
            "https://apnews.com/business",
        ),
        (
            "fed-press",
            "Federal Reserve · 官方公告",
            "Fed",
            "财经与监管",
            "en",
            "https://www.federalreserve.gov/feeds/press_all.xml",
            "https://www.federalreserve.gov/newsevents.htm",
        ),
        (
            "sec-press",
            "SEC · 官方新闻稿",
            "SEC",
            "财经与监管",
            "en",
            "https://www.sec.gov/news/pressreleases.rss",
            "https://www.sec.gov/newsroom/press-releases",
        ),
        // 机构与人物渠道（notes/理财/财经研究与交易人物-内容渠道索引.md）
        (
            "ms-podcast",
            "Morgan Stanley · Thoughts on the Market",
            "Morgan Stanley",
            "机构与人物",
            "en",
            "https://rss.art19.com/thoughts-on-the-market",
            "https://www.morganstanley.com/insights/podcasts/thoughts-on-the-market",
        ),
        (
            "ms-insights",
            "Morgan Stanley · Insights (Google News RSS)",
            "Morgan Stanley",
            "机构与人物",
            "en",
            "https://news.google.com/rss/search?q=site:morganstanley.com/insights+when:30d&hl=en-US&gl=US&ceid=US:en",
            "https://www.morganstanley.com/insights",
        ),
        (
            "xiaolin-yt",
            "小Lin说 (YouTube)",
            "小Lin说",
            "机构与人物",
            "zh",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCilwQlk62k1z7aUEZPOB6yw",
            "https://www.youtube.com/@xiao_lin_shuo",
        ),
    ];

    specs
        .iter()
        .map(
            |(id, name, outlet, category, language, feed_url, site_url)| MediaSource {
                id: (*id).into(),
                name: (*name).into(),
                outlet: (*outlet).into(),
                category: (*category).into(),
                language: (*language).into(),
                feed_url: (*feed_url).into(),
                site_url: (*site_url).into(),
                enabled: true,
                added_at: now.clone(),
            },
        )
        .collect()
}

#[derive(Default)]
struct FeedState {
    updated_at: Option<String>,
    last_refresh_instant: Option<Instant>,
    refreshing: bool,
    statuses: HashMap<String, (bool, usize, Option<String>, Option<String>)>,
    items: Vec<MediaItem>,
}

#[derive(Clone)]
pub struct MediaHub {
    db: Database,
    http: Client,
    state: Arc<RwLock<FeedState>>,
}

impl MediaHub {
    pub fn new(db: Database, http: Client) -> Self {
        Self {
            db,
            http,
            state: Arc::new(RwLock::new(FeedState::default())),
        }
    }

    pub fn spawn_background_sync(&self) {
        let hub = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(err) = hub.refresh_now(true).await {
                    warn!("background media sync failed: {}", err.1);
                }
                tokio::time::sleep(Duration::from_secs(600)).await;
            }
        });
    }

    pub async fn snapshot(
        &self,
        outlet: Option<&str>,
        category: Option<&str>,
        lang: Option<&str>,
        q: Option<&str>,
        limit: usize,
    ) -> Result<MediaFeedResponse, ApiError> {
        let sources = self.db.media_sources().await?;
        let guard = self.state.read().await;
        let enabled_ids: HashSet<&str> = sources
            .iter()
            .filter(|s| s.enabled)
            .map(|s| s.id.as_str())
            .collect();

        let source_statuses: Vec<MediaSourceStatus> = sources
            .iter()
            .map(|src| {
                let (ok, count, err, fetched_at) = guard
                    .statuses
                    .get(&src.id)
                    .cloned()
                    .unwrap_or((false, 0, None, None));
                MediaSourceStatus {
                    source: src.clone(),
                    ok,
                    item_count: count,
                    error: err,
                    fetched_at,
                }
            })
            .collect();

        let outlet_f = outlet.map(str::trim).filter(|s| !s.is_empty());
        let cat_f = category.map(str::trim).filter(|s| !s.is_empty());
        let lang_f = lang.map(str::trim).filter(|s| !s.is_empty());
        let q_lower = q
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());

        let items: Vec<MediaItem> = guard
            .items
            .iter()
            .filter(|item| enabled_ids.contains(item.source_id.as_str()))
            .filter(|item| outlet_f.is_none_or(|o| item.outlet.eq_ignore_ascii_case(o)))
            .filter(|item| cat_f.is_none_or(|c| item.category == c))
            .filter(|item| lang_f.is_none_or(|l| item.language.eq_ignore_ascii_case(l)))
            .filter(|item| {
                q_lower.as_ref().is_none_or(|needle| {
                    item.title.to_lowercase().contains(needle)
                        || item.outlet.to_lowercase().contains(needle)
                        || item.source_name.to_lowercase().contains(needle)
                        || item
                            .summary
                            .as_deref()
                            .is_some_and(|s| s.to_lowercase().contains(needle))
                })
            })
            .take(limit.clamp(1, 300))
            .cloned()
            .collect();

        Ok(MediaFeedResponse {
            updated_at: guard.updated_at.clone(),
            refreshing: guard.refreshing,
            sources: source_statuses,
            items,
        })
    }

    pub async fn refresh_now(&self, force: bool) -> Result<MediaFeedResponse, ApiError> {
        {
            let mut guard = self.state.write().await;
            if guard.refreshing {
                drop(guard);
                return self.snapshot(None, None, None, None, 150).await;
            }
            if !force {
                if let Some(last) = guard.last_refresh_instant {
                    if last.elapsed() < Duration::from_secs(12) {
                        drop(guard);
                        return self.snapshot(None, None, None, None, 150).await;
                    }
                }
            }
            guard.refreshing = true;
        }

        let sources = self.db.media_sources().await?;
        let sem = Arc::new(Semaphore::new(6));
        let mut handles = Vec::new();

        for src in sources.into_iter().filter(|s| s.enabled) {
            let permit = sem.clone().acquire_owned().await.expect("semaphore");
            let client = self.http.clone();
            handles.push(tokio::spawn(async move {
                let _permit = permit;
                let fetched_at = Utc::now().to_rfc3339();
                match fetch_single_source(&client, &src).await {
                    Ok(items) => (src.id, Ok(items), fetched_at),
                    Err(msg) => (src.id, Err(msg), fetched_at),
                }
            }));
        }

        let mut next_statuses = HashMap::new();
        let mut all_items = Vec::new();
        let mut ok_sources = 0usize;

        for handle in handles {
            if let Ok((id, res, fetched_at)) = handle.await {
                match res {
                    Ok(items) => {
                        ok_sources += 1;
                        next_statuses.insert(id, (true, items.len(), None, Some(fetched_at)));
                        all_items.extend(items);
                    }
                    Err(err) => {
                        next_statuses.insert(id, (false, 0, Some(err), Some(fetched_at)));
                    }
                }
            }
        }

        // Deduplicate by normalized URL or (outlet + lowercase title)
        let mut seen_urls = HashSet::new();
        let mut seen_titles = HashSet::new();
        all_items.sort_by(|a, b| b.published_at.cmp(&a.published_at));
        let mut deduped = Vec::with_capacity(all_items.len());
        for item in all_items {
            let url_key = item.url.trim().to_string();
            let title_key = format!("{}::{}", item.outlet.to_lowercase(), item.title.to_lowercase());
            if (!url_key.is_empty() && !seen_urls.insert(url_key))
                || !seen_titles.insert(title_key)
            {
                continue;
            }
            deduped.push(item);
        }

        let now = Utc::now().to_rfc3339();
        info!(
            "Media sync finished: {ok_sources} sources succeeded, {} articles",
            deduped.len()
        );

        {
            let mut guard = self.state.write().await;
            guard.updated_at = Some(now);
            guard.last_refresh_instant = Some(Instant::now());
            guard.refreshing = false;
            guard.statuses = next_statuses;
            guard.items = deduped;
        }

        self.snapshot(None, None, None, None, 150).await
    }

    pub async fn add_source(&self, req: AddMediaSourceRequest) -> Result<MediaFeedResponse, ApiError> {
        let name = req.name.trim();
        let outlet = req.outlet.trim();
        let feed_url = req.feed_url.trim();
        if name.is_empty() || outlet.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "频道名称和媒体名不能为空".into(),
            ));
        }
        if !(feed_url.starts_with("https://") || feed_url.starts_with("http://")) {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "RSS 地址必须以 http:// 或 https:// 开头".into(),
            ));
        }
        let site_url = if req.site_url.trim().is_empty() {
            feed_url.to_string()
        } else {
            req.site_url.trim().to_string()
        };
        let id = format!("custom-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let source = MediaSource {
            id,
            name: name.into(),
            outlet: outlet.into(),
            category: if req.category.trim().is_empty() {
                "自定义".into()
            } else {
                req.category.trim().into()
            },
            language: if req.language.trim().eq_ignore_ascii_case("zh") {
                "zh".into()
            } else {
                "en".into()
            },
            feed_url: feed_url.into(),
            site_url,
            enabled: true,
            added_at: Utc::now().to_rfc3339(),
        };

        // Verify the feed actually parses before persisting so broken/fake feeds are rejected immediately.
        let test_items = fetch_single_source(&self.http, &source)
            .await
            .map_err(|e| ApiError(StatusCode::BAD_REQUEST, format!("无法解析该 RSS 源: {e}")))?;
        if test_items.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "该地址未解析出有效 RSS/Atom 条目".into(),
            ));
        }

        self.db.upsert_media_source(source).await?;
        self.refresh_now(true).await
    }
}

async fn fetch_single_source(client: &Client, src: &MediaSource) -> Result<Vec<MediaItem>, String> {
    let mut resp = client
        .get(&src.feed_url)
        .header(
            reqwest::header::USER_AGENT,
            "Northstar/1.0 (Personal Research Terminal; contact@localhost)",
        )
        .header(
            reqwest::header::ACCEPT,
            "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        )
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    // Read up to 512 KiB so multi-year podcast feeds (e.g. 1,700+ episodes) return fast
    const MAX_BYTES: usize = 512 * 1024;
    let mut buf = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?
    {
        let remaining = MAX_BYTES.saturating_sub(buf.len());
        if remaining == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if buf.len() >= MAX_BYTES {
            break;
        }
    }
    let body = String::from_utf8_lossy(&buf);
    let parsed = parse_feed_xml(&body, src);
    Ok(parsed.into_iter().take(25).collect())
}

pub fn parse_feed_xml(xml: &str, src: &MediaSource) -> Vec<MediaItem> {
    let mut blocks = extract_blocks(xml, "item");
    let is_atom = blocks.is_empty();
    if is_atom {
        blocks = extract_blocks(xml, "entry");
    }

    let mut items = Vec::new();
    for (idx, block) in blocks.into_iter().enumerate() {
        let Some(raw_title) = extract_tag_text(&block, "title") else {
            continue;
        };
        let title = clean_text(&raw_title);
        if title.is_empty() {
            continue;
        }

        let url = if is_atom {
            extract_atom_link(&block).or_else(|| extract_tag_text(&block, "link"))
        } else {
            extract_tag_text(&block, "link").or_else(|| extract_atom_link(&block))
        }
        .map(|s| decode_entities(s.trim()))
        .unwrap_or_else(|| src.site_url.clone());

        let raw_date = extract_tag_text(&block, "pubDate")
            .or_else(|| extract_tag_text(&block, "published"))
            .or_else(|| extract_tag_text(&block, "updated"))
            .or_else(|| extract_tag_text(&block, "dc:date"));
        let published_at = raw_date.as_deref().and_then(parse_feed_date);

        let raw_desc = extract_tag_text(&block, "description")
            .or_else(|| extract_tag_text(&block, "summary"))
            .or_else(|| extract_tag_text(&block, "media:description"));
        let summary = raw_desc
            .map(|d| truncate_chars(&clean_text(&d), 200))
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case(&title));

        items.push(MediaItem {
            id: format!("{}-{idx}", src.id),
            source_id: src.id.clone(),
            source_name: src.name.clone(),
            outlet: src.outlet.clone(),
            category: src.category.clone(),
            language: src.language.clone(),
            title,
            url,
            summary,
            published_at,
        });
    }
    items
}

fn extract_blocks(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    let mut out = Vec::new();
    let mut cursor = 0;

    while let Some(rel_start) = xml[cursor..].find(&open_prefix) {
        let start = cursor + rel_start;
        let after_name = start + open_prefix.len();
        let next_byte = xml.as_bytes().get(after_name).copied();
        if !matches!(next_byte, Some(b'>' | b' ' | b'\t' | b'\r' | b'\n')) {
            cursor = after_name;
            continue;
        }
        let Some(open_end_rel) = xml[after_name..].find('>') else {
            break;
        };
        let content_start = after_name + open_end_rel + 1;
        let Some(close_rel) = xml[content_start..].find(&close_tag) else {
            break;
        };
        let content_end = content_start + close_rel;
        out.push(xml[content_start..content_end].to_string());
        cursor = content_end + close_tag.len();
    }
    out
}

fn extract_tag_text(block: &str, tag: &str) -> Option<String> {
    let open_prefix = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    let mut cursor = 0;
    while let Some(rel_start) = block[cursor..].find(&open_prefix) {
        let start = cursor + rel_start;
        let after_name = start + open_prefix.len();
        let next_byte = block.as_bytes().get(after_name).copied();
        if !matches!(next_byte, Some(b'>' | b' ' | b'\t' | b'\r' | b'\n' | b'/')) {
            cursor = after_name;
            continue;
        }
        let open_end_rel = block[after_name..].find('>')?;
        let tag_header = &block[after_name..after_name + open_end_rel];
        if tag_header.ends_with('/') {
            cursor = after_name + open_end_rel + 1;
            continue;
        }
        let content_start = after_name + open_end_rel + 1;
        let close_rel = block[content_start..].find(&close_tag)?;
        let raw = &block[content_start..content_start + close_rel];
        return Some(strip_cdata(raw).trim().to_string());
    }
    None
}

fn extract_atom_link(block: &str) -> Option<String> {
    let mut cursor = 0;
    let mut fallback = None;
    while let Some(rel) = block[cursor..].find("<link") {
        let start = cursor + rel + 5;
        if !matches!(
            block.as_bytes().get(start).copied(),
            Some(b' ' | b'\t' | b'\r' | b'\n' | b'>' | b'/')
        ) {
            cursor = start;
            continue;
        }
        let Some(end_rel) = block[start..].find('>') else {
            break;
        };
        let attrs = &block[start..start + end_rel];
        if let Some(href) = extract_attr(attrs, "href") {
            let rel_attr = extract_attr(attrs, "rel").unwrap_or_default();
            if rel_attr.is_empty() || rel_attr.eq_ignore_ascii_case("alternate") {
                return Some(href);
            }
            if fallback.is_none() {
                fallback = Some(href);
            }
        }
        cursor = start + end_rel + 1;
    }
    fallback
}

fn extract_attr(attrs: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let needle = format!("{name}={quote}");
        if let Some(idx) = attrs.find(&needle) {
            let rest = &attrs[idx + needle.len()..];
            if let Some(end) = rest.find(quote) {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

fn strip_cdata(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("<![CDATA[") {
        if let Some(inner) = rest.strip_suffix("]]>") {
            return inner;
        }
    }
    trimmed
}

fn clean_text(raw: &str) -> String {
    let decoded_once = decode_entities(strip_cdata(raw));
    let stripped = strip_html_tags(&decoded_once);
    let decoded_twice = decode_entities(&stripped);
    decoded_twice
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();
    while let Some((idx, ch)) = chars.next() {
        if ch != '&' {
            out.push(ch);
            continue;
        }
        if let Some(semi_rel) = input[idx + 1..].find(';') {
            if semi_rel <= 10 {
                let entity = &input[idx + 1..idx + 1 + semi_rel];
                let decoded = match entity {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    "mdash" => Some('—'),
                    "ndash" => Some('–'),
                    "lsquo" => Some('‘'),
                    "rsquo" => Some('’'),
                    "ldquo" => Some('“'),
                    "rdquo" => Some('”'),
                    s if s.starts_with("#x") || s.starts_with("#X") => {
                        u32::from_str_radix(&s[2..], 16).ok().and_then(char::from_u32)
                    }
                    s if s.starts_with('#') => s[1..].parse::<u32>().ok().and_then(char::from_u32),
                    _ => None,
                };
                if let Some(c) = decoded {
                    out.push(c);
                    let target = idx + 1 + semi_rel;
                    while let Some(&(next_i, _)) = chars.peek() {
                        chars.next();
                        if next_i >= target {
                            break;
                        }
                    }
                    continue;
                }
            }
        }
        out.push('&');
    }
    out
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let head: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn parse_feed_date(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return Some(dt.with_timezone(&Utc).to_rfc3339());
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Utc).to_rfc3339());
    }
    // Handle RFC 2822 with named US timezone abbreviations (EST/EDT/PST/PDT/GMT/UTC)
    for (abbr, offset) in [
        (" EDT", " -0400"),
        (" EST", " -0500"),
        (" PDT", " -0700"),
        (" PST", " -0800"),
        (" GMT", " +0000"),
        (" UTC", " +0000"),
    ] {
        if let Some(prefix) = trimmed.strip_suffix(abbr) {
            let normalized = format!("{prefix}{offset}");
            if let Ok(dt) = DateTime::parse_from_rfc2822(&normalized) {
                return Some(dt.with_timezone(&Utc).to_rfc3339());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_source() -> MediaSource {
        MediaSource {
            id: "test-src".into(),
            name: "Test Feed".into(),
            outlet: "Bloomberg".into(),
            category: "核心媒体".into(),
            language: "en".into(),
            feed_url: "https://example.com/rss".into(),
            site_url: "https://example.com".into(),
            enabled: true,
            added_at: "2026-11-20T00:00:00Z".into(),
        }
    }

    #[test]
    fn parses_rss_with_cdata_html_and_rfc2822_date() {
        let xml = r#"
        <rss version="2.0"><channel>
          <item>
            <title><![CDATA[Anthropic &amp; Markets: IPO Jumps 17%]]></title>
            <link>https://www.bloomberg.com/news/articles/123?a=1&amp;b=2</link>
            <pubDate>Thu, 19 Nov 2026 21:30:00 GMT</pubDate>
            <description><![CDATA[<p>Shares jumped &ldquo;sharply&rdquo; after debut.</p>]]></description>
          </item>
        </channel></rss>"#;
        let items = parse_feed_xml(xml, &sample_source());
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Anthropic & Markets: IPO Jumps 17%");
        assert_eq!(items[0].url, "https://www.bloomberg.com/news/articles/123?a=1&b=2");
        assert_eq!(items[0].published_at.as_deref(), Some("2026-11-19T21:30:00+00:00"));
        assert_eq!(items[0].summary.as_deref(), Some("Shares jumped “sharply” after debut."));
    }

    #[test]
    fn parses_atom_youtube_feed() {
        let xml = r#"
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Wall Street ends sharply lower</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
            <published>2026-11-20T01:05:00+00:00</published>
            <media:description>Market recap video</media:description>
          </entry>
        </feed>"#;
        let items = parse_feed_xml(xml, &sample_source());
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Wall Street ends sharply lower");
        assert_eq!(items[0].url, "https://www.youtube.com/watch?v=abc123");
        assert_eq!(items[0].published_at.as_deref(), Some("2026-11-20T01:05:00+00:00"));
        assert_eq!(items[0].summary.as_deref(), Some("Market recap video"));
    }
}
