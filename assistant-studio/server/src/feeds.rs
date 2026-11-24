use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::{
    db::{Database, FeedSourceRecord, ReaderCacheRecord},
    vault::{atomic_write, index_single_file, slugify_filename, validate_rel_path},
    ApiError,
};

#[derive(Deserialize)]
pub struct AddFeedSourceRequest {
    pub name: String,
    #[serde(default = "default_group")]
    pub group_name: String,
    pub feed_url: String,
    #[serde(default)]
    pub site_url: String,
}

#[derive(Deserialize)]
pub struct ImportOpmlRequest {
    pub opml_xml: String,
    #[serde(default = "default_opml_group")]
    pub group_name: String,
}

#[derive(Serialize)]
pub struct ReaderResponse {
    pub status: String, // ok | blocked
    pub reason: Option<String>,
    pub url: String,
    pub title: String,
    pub byline: Option<String>,
    pub clean_html: String,
    pub plain_text: String,
    pub word_count: usize,
    pub fetched_at: String,
}

#[derive(Deserialize)]
pub struct ArchiveArticleRequest {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub highlights: Vec<String>,
    pub feed_item_id: Option<String>,
}

fn default_group() -> String {
    "自定义".into()
}
fn default_opml_group() -> String {
    "软件工程与开发生态".into()
}

pub fn default_feed_sources() -> Vec<FeedSourceRecord> {
    let specs: &[(&str, &str, &str, &str, &str, &str, &str)] = &[
        // ── AI 与前沿研究（原 AI 博客 + 头部研究者，原「今日技术与 AI 精选」统一归入此分类）──
        (
            "openai-news",
            "OpenAI News",
            "AI 与前沿研究",
            "rss",
            "https://openai.com/news/rss.xml",
            "https://openai.com/news/",
            "OpenAI 官方研究、产品与工程动态",
        ),
        (
            "anthropic-news",
            "Anthropic (Research & Engineering)",
            "AI 与前沿研究",
            "rss",
            "https://news.google.com/rss/search?q=site:anthropic.com/research+OR+site:anthropic.com/engineering+when:30d&hl=en-US&gl=US&ceid=US:en",
            "https://www.anthropic.com/research",
            "Anthropic 官方研究与 Claude 工程博客",
        ),
        (
            "langchain-blog",
            "LangChain Blog",
            "AI 与前沿研究",
            "rss",
            "https://blog.langchain.dev/rss/",
            "https://blog.langchain.dev/",
            "LangChain / LangGraph Agent 工程与实战架构博客",
        ),
        (
            "huggingface-blog",
            "Hugging Face Blog",
            "AI 与前沿研究",
            "rss",
            "https://huggingface.co/blog/feed.xml",
            "https://huggingface.co/blog",
            "开源大模型、训练框架与评测生态博客",
        ),
        (
            "simon-willison",
            "Simon Willison's Weblog",
            "AI 与前沿研究",
            "atom",
            "https://simonwillison.net/atom/everything/",
            "https://simonwillison.net/",
            "Karpathy 同圈高频推荐 · Simon Willison：LLM 工具链、Datasette 与 AI 实测笔记",
        ),
        (
            "lilian-weng",
            "Lil'Log (Lilian Weng)",
            "AI 与前沿研究",
            "rss",
            "https://lilianweng.github.io/index.xml",
            "https://lilianweng.github.io/",
            "Lilian Weng：大模型、推理、Agent 与强化学习权威综述",
        ),
        (
            "karpathy-yt",
            "Andrej Karpathy (YouTube)",
            "AI 与前沿研究",
            "atom",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCXUPKJO5MZQN11PqgIvyuvQ",
            "https://www.youtube.com/@AndrejKarpathy",
            "Andrej Karpathy 本人深度教程频道（LLM 原理、GPT-2 复现与 AI 实践）",
        ),
        (
            "hn-frontpage",
            "Hacker News Frontpage",
            "软件工程与开发生态",
            "rss",
            "https://hnrss.org/frontpage",
            "https://news.ycombinator.com/",
            "硅谷工程师与独立黑客社区每日技术热榜",
        ),
        // ── 投研核心财经媒体（与投研模块统一合并）────────────────────────
        (
            "bloomberg-markets",
            "Bloomberg · Markets",
            "核心财经",
            "rss",
            "https://feeds.bloomberg.com/markets/news.rss",
            "https://www.bloomberg.com/markets",
            "彭博全球市场、股市、债市与大宗商品快讯",
        ),
        (
            "bloomberg-tech-wiki",
            "Bloomberg · Technology",
            "核心财经",
            "rss",
            "https://feeds.bloomberg.com/technology/news.rss",
            "https://www.bloomberg.com/technology",
            "彭博全球科技巨头、AI 资本开支与芯片产业链报道",
        ),
        (
            "bloomberg-econ",
            "Bloomberg · Economics",
            "核心财经",
            "rss",
            "https://feeds.bloomberg.com/economics/news.rss",
            "https://www.bloomberg.com/economics",
            "彭博全球宏观经济、通胀与央行政策追踪",
        ),
        (
            "bloomberg-yt",
            "Bloomberg TV (YouTube)",
            "核心财经",
            "atom",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCIALMKvObZNtJ6AmdCLP7Lg",
            "https://www.youtube.com/@markets",
            "彭博电视市场访谈与交易日点评视频",
        ),
        (
            "reuters-news",
            "Reuters · 快讯 (Google News RSS)",
            "核心财经",
            "rss",
            "https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en",
            "https://www.reuters.com/",
            "路透社全球财经、地缘与企业突发新闻",
        ),
        (
            "reuters-yt",
            "Reuters (YouTube)",
            "核心财经",
            "atom",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ",
            "https://www.youtube.com/@Reuters",
            "路透社新闻视频频道",
        ),
        (
            "wsj-cn",
            "WSJ 中文网 (Google News RSS)",
            "核心财经",
            "rss",
            "https://news.google.com/rss/search?q=site:cn.wsj.com+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
            "https://cn.wsj.com/",
            "华尔街日报中文深度报道",
        ),
        (
            "wsj-markets",
            "WSJ · Markets",
            "核心财经",
            "rss",
            "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
            "https://www.wsj.com/finance",
            "华尔街日报资本市场与投资专题",
        ),
        (
            "wsj-business",
            "WSJ · US Business",
            "核心财经",
            "rss",
            "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness",
            "https://www.wsj.com/business",
            "华尔街日报美国商业与上市公司动态",
        ),
        (
            "wsj-tech-wiki",
            "WSJ · Tech",
            "核心财经",
            "rss",
            "https://feeds.content.dowjones.io/public/rss/RSSWSJD",
            "https://www.wsj.com/tech",
            "华尔街日报科技与硅谷商业报道",
        ),
        (
            "nyt-cn-wiki",
            "纽约时报中文网",
            "核心财经",
            "rss",
            "https://cn.nytimes.com/rss/",
            "https://cn.nytimes.com/",
            "纽约时报中文国际与商业专栏",
        ),
        (
            "nyt-business",
            "NYT · Business",
            "核心财经",
            "rss",
            "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
            "https://www.nytimes.com/section/business",
            "纽约时报商业与华尔街专题",
        ),
        (
            "nyt-economy",
            "NYT · Economy",
            "核心财经",
            "rss",
            "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
            "https://www.nytimes.com/section/business/economy",
            "纽约时报宏观经济专题",
        ),
        (
            "nyt-tech",
            "NYT · Technology",
            "核心财经",
            "rss",
            "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
            "https://www.nytimes.com/section/technology",
            "纽约时报科技与 AI 行业报道",
        ),
        // ── 财经监管与宏微观 ───────────────────────────────────────────────
        (
            "ft-markets",
            "Financial Times · Markets",
            "财经监管",
            "rss",
            "https://www.ft.com/markets?format=rss",
            "https://www.ft.com/markets",
            "英国《金融时报》全球资本市场与宏观评论",
        ),
        (
            "ap-business",
            "AP News · Business (Google News RSS)",
            "财经监管",
            "rss",
            "https://news.google.com/rss/search?q=site:apnews.com+business+OR+markets+when:3d&hl=en-US&gl=US&ceid=US:en",
            "https://apnews.com/business",
            "美联社商业与宏观政策快讯",
        ),
        (
            "fed-press",
            "Federal Reserve · 官方公告",
            "财经监管",
            "rss",
            "https://www.federalreserve.gov/feeds/press_all.xml",
            "https://www.federalreserve.gov/newsevents.htm",
            "美联储官方货币政策、FOMC 与金融监管公告",
        ),
        (
            "sec-press",
            "SEC · 官方新闻稿",
            "财经监管",
            "rss",
            "https://www.sec.gov/news/pressreleases.rss",
            "https://www.sec.gov/newsroom/press-releases",
            "美国证监会（SEC）官方监管与执法公告",
        ),
        // ── 投研机构与人物 ─────────────────────────────────────────────────
        (
            "ms-podcast",
            "Morgan Stanley · Thoughts on the Market",
            "机构与人物",
            "rss",
            "https://rss.art19.com/thoughts-on-the-market",
            "https://www.morganstanley.com/insights/podcasts/thoughts-on-the-market",
            "摩根士丹利每日市场策略短播客",
        ),
        (
            "ms-insights",
            "Morgan Stanley · Insights (Google News RSS)",
            "机构与人物",
            "rss",
            "https://news.google.com/rss/search?q=site:morganstanley.com/insights+when:30d&hl=en-US&gl=US&ceid=US:en",
            "https://www.morganstanley.com/insights",
            "摩根士丹利全球投研洞察报告",
        ),
        (
            "xiaolin-yt",
            "小Lin说 (YouTube)",
            "机构与人物",
            "atom",
            "https://www.youtube.com/feeds/videos.xml?channel_id=UCilwQlk62k1z7aUEZPOB6yw",
            "https://www.youtube.com/@xiao_lin_shuo",
            "中文财经宏观、商业案例与行业深度科普视频",
        ),
    ];

    specs
        .iter()
        .map(|(id, name, group, kind, feed_url, site_url, desc)| FeedSourceRecord {
            id: (*id).into(),
            name: (*name).into(),
            group_name: (*group).into(),
            kind: (*kind).into(),
            feed_url: (*feed_url).into(),
            site_url: (*site_url).into(),
            description: (*desc).into(),
            enabled: true,
            last_ok: false,
            last_error: None,
            last_fetched_at: None,
        })
        .collect()
}

#[derive(Clone)]
pub struct FeedManager {
    db: Database,
    http: Client,
    vault_root: PathBuf,
}

impl FeedManager {
    pub fn new(db: Database, http: Client, vault_root: PathBuf) -> Self {
        Self {
            db,
            http,
            vault_root,
        }
    }

    pub async fn seed_defaults_if_needed(&self) -> Result<(), ApiError> {
        if self
            .db
            .get_meta("feeds_taxonomy_v3".into())
            .await?
            .is_some()
        {
            return Ok(());
        }
        // 1. Upsert all curated default sources (incl. LangChain Blog & descriptions)
        for src in default_feed_sources() {
            self.db.upsert_feed_source(src).await?;
        }
        // 2. Reclassify all existing Karpathy 92 / legacy tech sources into 5 clear thematic categories
        let existing = self.db.list_feed_sources().await?;
        for src in existing {
            if let Some((group, desc)) =
                crate::feed_catalog::classify_karpathy_source(&src.name, &src.site_url, &src.feed_url)
            {
                self.db
                    .update_feed_source_classification(src.id, group.into(), desc.into())
                    .await?;
                continue;
            }
            let legacy_reclass = match src.group_name.as_str() {
                "Karpathy 92" | "Karpathy / OPML" | "科技资讯" => Some("软件工程与开发生态"),
                "AI博客" | "科技博主" => Some("AI 与前沿研究"),
                _ => None,
            };
            if let Some(new_group) = legacy_reclass {
                self.db
                    .update_feed_source_classification(src.id, new_group.into(), src.description)
                    .await?;
            }
        }
        self.db
            .set_meta("feeds_seeded_v2".into(), "1".into())
            .await?;
        self.db
            .set_meta("feeds_taxonomy_v3".into(), "1".into())
            .await?;
        Ok(())
    }

    pub fn spawn_background_sync(&self) {
        let mgr = self.clone();
        tokio::spawn(async move {
            let _ = mgr.seed_defaults_if_needed().await;
            loop {
                if let Err(e) = mgr.refresh_all().await {
                    warn!("feed refresh error: {}", e.1);
                }
                tokio::time::sleep(Duration::from_secs(900)).await;
            }
        });
    }

    pub async fn refresh_all(&self) -> Result<usize, ApiError> {
        let sources = self.db.list_feed_sources().await?;
        let sem = Arc::new(Semaphore::new(6));
        let mut handles = Vec::new();

        for src in sources.into_iter().filter(|s| s.enabled) {
            let permit = sem.clone().acquire_owned().await.expect("sem");
            let client = self.http.clone();
            handles.push(tokio::spawn(async move {
                let _permit = permit;
                let res = fetch_feed(&client, &src).await;
                (src.id, res)
            }));
        }

        let mut total = 0usize;
        for handle in handles {
            if let Ok((id, res)) = handle.await {
                match res {
                    Ok(items) => {
                        let count = items.len();
                        let _ = self.db.upsert_feed_items(items).await;
                        let _ = self.db.update_feed_source_status(id, true, None).await;
                        total += count;
                    }
                    Err(err) => {
                        let _ = self
                            .db
                            .update_feed_source_status(id, false, Some(err))
                            .await;
                    }
                }
            }
        }

        info!("MyWiki feeds refreshed: {total} items processed");
        Ok(total)
    }

    /// Fast refresh of only enabled financial subscription feeds (核心财经 / 财经监管 / 机构与人物).
    pub async fn refresh_finance_feeds(&self) -> Result<usize, ApiError> {
        let sources = self.db.list_feed_sources().await?;
        let sem = Arc::new(Semaphore::new(12));
        let mut handles = Vec::new();

        for src in sources.into_iter().filter(|s| {
            s.enabled
                && matches!(
                    s.group_name.as_str(),
                    "核心财经" | "财经监管" | "机构与人物"
                )
        }) {
            let permit = sem.clone().acquire_owned().await.expect("sem");
            let client = self.http.clone();
            handles.push(tokio::spawn(async move {
                let _permit = permit;
                let res = fetch_feed(&client, &src).await;
                (src.id, res)
            }));
        }

        let mut total = 0usize;
        for handle in handles {
            if let Ok((id, res)) = handle.await {
                match res {
                    Ok(items) => {
                        let count = items.len();
                        let _ = self.db.upsert_feed_items(items).await;
                        let _ = self.db.update_feed_source_status(id, true, None).await;
                        total += count;
                    }
                    Err(err) => {
                        let _ = self
                            .db
                            .update_feed_source_status(id, false, Some(err))
                            .await;
                    }
                }
            }
        }
        info!("Financial feeds refreshed: {total} items processed");
        Ok(total)
    }

    pub async fn add_source(&self, req: AddFeedSourceRequest) -> Result<FeedSourceRecord, ApiError> {
        let name = req.name.trim();
        let feed_url = req.feed_url.trim();
        if name.is_empty()
            || !(feed_url.starts_with("http://") || feed_url.starts_with("https://"))
        {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "请填写有效的订阅名与 http(s) RSS/Atom 地址".into(),
            ));
        }
        let src = FeedSourceRecord {
            id: format!("custom-{}", &uuid::Uuid::new_v4().to_string()[..8]),
            name: name.into(),
            group_name: if req.group_name.trim().is_empty() {
                "自定义".into()
            } else {
                req.group_name.trim().into()
            },
            kind: "rss".into(),
            feed_url: feed_url.into(),
            site_url: if req.site_url.trim().is_empty() {
                feed_url.into()
            } else {
                req.site_url.trim().into()
            },
            description: String::new(),
            enabled: true,
            last_ok: false,
            last_error: None,
            last_fetched_at: None,
        };
        let items = fetch_feed(&self.http, &src)
            .await
            .map_err(|e| ApiError(StatusCode::BAD_REQUEST, format!("无法解析该 RSS/Atom 源: {e}")))?;
        if items.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "该地址未解析出有效条目".into(),
            ));
        }
        self.db.upsert_feed_source(src.clone()).await?;
        self.db.upsert_feed_items(items).await?;
        self.db
            .update_feed_source_status(src.id.clone(), true, None)
            .await?;
        Ok(src)
    }

    pub async fn import_opml(&self, req: ImportOpmlRequest) -> Result<usize, ApiError> {
        let parsed = parse_opml(&req.opml_xml);
        if parsed.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "未在 OPML 中找到有效的 xmlUrl 订阅源".into(),
            ));
        }
        let group = if req.group_name.trim().is_empty() {
            "OPML 导入".to_string()
        } else {
            req.group_name.trim().to_string()
        };
        let mut count = 0usize;
        for (title, xml_url, html_url) in parsed {
            let id = format!("opml-{}", item_id(&xml_url));
            let site = html_url.unwrap_or_else(|| xml_url.clone());
            let (resolved_group, resolved_desc) =
                match crate::feed_catalog::classify_karpathy_source(&title, &site, &xml_url) {
                    Some((g, d)) => (g.to_string(), d.to_string()),
                    None => (group.clone(), String::new()),
                };
            let src = FeedSourceRecord {
                id,
                name: title,
                group_name: resolved_group,
                kind: "rss".into(),
                feed_url: xml_url,
                site_url: site,
                description: resolved_desc,
                enabled: true,
                last_ok: false,
                last_error: None,
                last_fetched_at: None,
            };
            self.db.upsert_feed_source(src).await?;
            count += 1;
        }
        let mgr = self.clone();
        tokio::spawn(async move {
            let _ = mgr.refresh_all().await;
        });
        Ok(count)
    }

    pub async fn fetch_reader(&self, raw_url: &str, force: bool) -> Result<ReaderResponse, ApiError> {
        let url = raw_url.trim();
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "阅读器仅支持 http:// 或 https:// 链接".into(),
            ));
        }

        if !force {
            if let Some(cached) = self.db.get_reader_cache(url.to_string()).await? {
                let words = cached.plain_text.chars().filter(|c| !c.is_whitespace()).count();
                return Ok(ReaderResponse {
                    status: "ok".into(),
                    reason: None,
                    url: cached.url,
                    title: cached.title,
                    byline: cached.byline,
                    clean_html: cached.clean_html,
                    plain_text: cached.plain_text,
                    word_count: words,
                    fetched_at: cached.fetched_at,
                });
            }
        }

        let resp = match self
            .http
            .get(url)
            .header(
                reqwest::header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
            )
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .timeout(Duration::from_secs(12))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return Ok(ReaderResponse {
                    status: "blocked".into(),
                    reason: Some(format!("网络直连失败：{e}")),
                    url: url.into(),
                    title: url.into(),
                    byline: None,
                    clean_html: String::new(),
                    plain_text: String::new(),
                    word_count: 0,
                    fetched_at: Utc::now().to_rfc3339(),
                });
            }
        };

        let status_code = resp.status();
        if !status_code.is_success() {
            return Ok(ReaderResponse {
                status: "blocked".into(),
                reason: Some(format!(
                    "目标站点返回 HTTP {}（可能存在付费墙、登录校验或访问限制），请点击右上角在外部浏览器打开。",
                    status_code.as_u16()
                )),
                url: url.into(),
                title: url.into(),
                byline: None,
                clean_html: String::new(),
                plain_text: String::new(),
                word_count: 0,
                fetched_at: Utc::now().to_rfc3339(),
            });
        }

        let raw_html = resp.text().await.unwrap_or_default();
        let (title, clean_html, plain_text) = extract_readable_article(&raw_html, url);
        let word_count = plain_text.chars().filter(|c| !c.is_whitespace()).count();
        let now = Utc::now().to_rfc3339();

        if word_count < 60 {
            return Ok(ReaderResponse {
                status: "blocked".into(),
                reason: Some(
                    "未能抽取到足够的正文内容（目标页可能是纯前端渲染、付费墙或需要登录），请使用外部浏览器打开。"
                        .into(),
                ),
                url: url.into(),
                title,
                byline: None,
                clean_html: String::new(),
                plain_text,
                word_count,
                fetched_at: now,
            });
        }

        let cache = ReaderCacheRecord {
            url: url.into(),
            title: title.clone(),
            byline: None,
            clean_html: clean_html.clone(),
            plain_text: plain_text.clone(),
            fetched_at: now.clone(),
        };
        let _ = self.db.put_reader_cache(cache).await;

        Ok(ReaderResponse {
            status: "ok".into(),
            reason: None,
            url: url.into(),
            title,
            byline: None,
            clean_html,
            plain_text,
            word_count,
            fetched_at: now,
        })
    }

    pub async fn archive_to_worth_reading(
        &self,
        req: ArchiveArticleRequest,
    ) -> Result<String, ApiError> {
        let title = req.title.trim();
        let url = req.url.trim();
        if title.is_empty() || url.is_empty() {
            return Err(ApiError(StatusCode::BAD_REQUEST, "标题和链接不能为空".into()));
        }
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let slug = slugify_filename(title);
        let rel = validate_rel_path(&format!("worth-reading/reading-notes/{today}-{slug}.md"))?;

        let mut body = format!(
            "---\ntitle: {title}\nsource: {}\nurl: {url}\ncreated: {today}\ntags:\n  - worth-reading\n  - reading-note\n---\n\n# {title}\n\n- 原文链接：[{title}]({url})\n",
            if req.source_name.trim().is_empty() {
                "Web"
            } else {
                req.source_name.trim()
            }
        );
        if !req.summary.trim().is_empty() {
            body.push_str("\n## 摘要\n\n");
            body.push_str(req.summary.trim());
            body.push('\n');
        }
        if !req.highlights.is_empty() {
            body.push_str("\n## 摘录与笔记\n\n");
            for h in &req.highlights {
                if !h.trim().is_empty() {
                    body.push_str(&format!("> {}\n\n", h.trim().replace('\n', "\n> ")));
                }
            }
        }
        body.push_str("\n## Sources\n\n");
        body.push_str(&format!("- [{title}]({url})\n"));

        atomic_write(&self.vault_root.join(&rel), &body)?;
        index_single_file(&self.vault_root, &self.db, &rel).await?;

        if let Some(fid) = req.feed_item_id {
            let _ = self
                .db
                .update_feed_item_flags(fid, Some(true), None, Some(rel.clone()))
                .await;
        }
        Ok(rel)
    }
}

fn item_id(url: &str) -> String {
    let mut h = DefaultHasher::new();
    url.trim().hash(&mut h);
    format!("{:016x}", h.finish())
}

async fn fetch_feed(
    client: &Client,
    src: &FeedSourceRecord,
) -> Result<Vec<(String, String, String, String, Option<String>, Option<String>)>, String> {
    let mut resp = client
        .get(&src.feed_url)
        .header(
            reqwest::header::USER_AGENT,
            "MyWikiStudio/1.0 (Personal Research Reader; contact@localhost)",
        )
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("网络失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    const MAX_BYTES: usize = 512 * 1024;
    let mut buf = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("读取失败: {e}"))? {
        let rem = MAX_BYTES.saturating_sub(buf.len());
        if rem == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..chunk.len().min(rem)]);
        if buf.len() >= MAX_BYTES {
            break;
        }
    }
    let xml = String::from_utf8_lossy(&buf);
    Ok(parse_rss_or_atom(&xml, &src.id, &src.site_url)
        .into_iter()
        .take(25)
        .collect())
}

pub fn parse_rss_or_atom(
    xml: &str,
    source_id: &str,
    fallback_site: &str,
) -> Vec<(String, String, String, String, Option<String>, Option<String>)> {
    let mut blocks = extract_blocks(xml, "item");
    let is_atom = blocks.is_empty();
    if is_atom {
        blocks = extract_blocks(xml, "entry");
    }
    let mut out = Vec::new();
    for block in blocks {
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
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        .unwrap_or_else(|| fallback_site.to_string());

        let raw_date = extract_tag_text(&block, "pubDate")
            .or_else(|| extract_tag_text(&block, "published"))
            .or_else(|| extract_tag_text(&block, "updated"))
            .or_else(|| extract_tag_text(&block, "dc:date"));
        let published_at = raw_date.as_deref().and_then(parse_date);

        let raw_desc = extract_tag_text(&block, "description")
            .or_else(|| extract_tag_text(&block, "summary"))
            .or_else(|| extract_tag_text(&block, "media:description"));
        let summary = raw_desc
            .map(|d| truncate_chars(&clean_text(&d), 220))
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case(&title));

        out.push((
            item_id(&url),
            source_id.to_string(),
            title,
            url,
            summary,
            published_at,
        ));
    }
    out
}

pub fn parse_opml(xml: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(rel) = xml[cursor..].find("<outline") {
        let start = cursor + rel + 8;
        let Some(end_rel) = xml[start..].find('>') else {
            break;
        };
        let attrs = &xml[start..start + end_rel];
        if let Some(xml_url) = extract_attr(attrs, "xmlUrl").or_else(|| extract_attr(attrs, "xmlurl")) {
            let xml_clean = decode_entities(xml_url.trim());
            if xml_clean.starts_with("http://") || xml_clean.starts_with("https://") {
                let title = extract_attr(attrs, "title")
                    .or_else(|| extract_attr(attrs, "text"))
                    .map(|s| decode_entities(s.trim()))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| xml_clean.clone());
                let html_url = extract_attr(attrs, "htmlUrl").map(|s| decode_entities(s.trim()));
                out.push((title, xml_clean, html_url));
            }
        }
        cursor = start + end_rel + 1;
    }
    out
}

/// Safe, self-contained readable article extractor & HTML sanitizer for Reader Mode.
pub fn extract_readable_article(raw_html: &str, base_url: &str) -> (String, String, String) {
    let title = extract_tag_ci(raw_html, "title")
        .map(|s| clean_text(&s))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| base_url.to_string());

    // Prefer <article>, else <main>, else <body>
    let region = extract_tag_ci(raw_html, "article")
        .or_else(|| extract_tag_ci(raw_html, "main"))
        .or_else(|| extract_tag_ci(raw_html, "body"))
        .unwrap_or_else(|| raw_html.to_string());

    let mut cleaned = region;
    for noisy in ["script", "style", "noscript", "svg", "nav", "footer", "aside", "form", "iframe", "button"] {
        cleaned = remove_tag_blocks_ci(&cleaned, noisy);
    }
    cleaned = strip_html_comments(&cleaned);

    let sanitized_html = sanitize_html(&cleaned, base_url);
    let plain_text = clean_text(&sanitized_html);
    (title, sanitized_html, plain_text)
}

fn strip_html_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut cur = 0;
    while let Some(rel) = s[cur..].find("<!--") {
        out.push_str(&s[cur..cur + rel]);
        if let Some(end) = s[cur + rel + 4..].find("-->") {
            cur = cur + rel + 4 + end + 3;
        } else {
            return out;
        }
    }
    out.push_str(&s[cur..]);
    out
}

fn remove_tag_blocks_ci(input: &str, tag: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(input.len());
    let mut cur = 0;
    while let Some(rel) = lower[cur..].find(&open) {
        let start = cur + rel;
        let after = start + open.len();
        if !matches!(
            lower.as_bytes().get(after).copied(),
            Some(b'>' | b' ' | b'\t' | b'\r' | b'\n' | b'/')
        ) {
            out.push_str(&input[cur..after]);
            cur = after;
            continue;
        }
        out.push_str(&input[cur..start]);
        if let Some(end_rel) = lower[after..].find(&close) {
            cur = after + end_rel + close.len();
        } else if let Some(gt) = lower[after..].find('>') {
            cur = after + gt + 1;
        } else {
            return out;
        }
    }
    out.push_str(&input[cur..]);
    out
}

fn extract_tag_ci(input: &str, tag: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut cur = 0;
    while let Some(rel) = lower[cur..].find(&open) {
        let start = cur + rel;
        let after = start + open.len();
        if !matches!(
            lower.as_bytes().get(after).copied(),
            Some(b'>' | b' ' | b'\t' | b'\r' | b'\n')
        ) {
            cur = after;
            continue;
        }
        let gt = lower[after..].find('>')?;
        let body_start = after + gt + 1;
        let close_rel = lower[body_start..].find(&close)?;
        return Some(input[body_start..body_start + close_rel].to_string());
    }
    None
}

fn resolve_relative_url(href: &str, base_url: &str) -> Option<String> {
    let h = href.trim();
    if h.is_empty() || h.starts_with("javascript:") || h.starts_with("data:") {
        return None;
    }
    if h.starts_with("http://") || h.starts_with("https://") {
        return Some(h.to_string());
    }
    if h.starts_with("//") {
        return Some(format!("https:{h}"));
    }
    if h.starts_with('/') {
        let scheme_end = base_url.find("://")? + 3;
        let host_end = base_url[scheme_end..]
            .find('/')
            .map(|i| scheme_end + i)
            .unwrap_or(base_url.len());
        return Some(format!("{}{}", &base_url[..host_end], h));
    }
    None
}

fn sanitize_html(input: &str, base_url: &str) -> String {
    const ALLOWED: &[&str] = &[
        "p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code", "strong",
        "b", "em", "i", "br", "hr", "a", "img", "table", "thead", "tbody", "tr", "th", "td",
        "figure", "figcaption",
    ];
    let mut out = String::with_capacity(input.len());
    let mut cur = 0;
    while let Some(lt_rel) = input[cur..].find('<') {
        let lt = cur + lt_rel;
        out.push_str(&input[cur..lt]);
        let Some(gt_rel) = input[lt + 1..].find('>') else {
            break;
        };
        let gt = lt + 1 + gt_rel;
        let raw_tag = input[lt + 1..gt].trim();
        cur = gt + 1;
        if raw_tag.is_empty() || raw_tag.starts_with('!') || raw_tag.starts_with('?') {
            continue;
        }
        let closing = raw_tag.starts_with('/');
        let inner = raw_tag.trim_start_matches('/').trim_end_matches('/').trim();
        let name = inner
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if !ALLOWED.contains(&name.as_str()) {
            if matches!(name.as_str(), "div" | "section") {
                out.push('\n');
            }
            continue;
        }
        if closing {
            out.push_str(&format!("</{name}>"));
            continue;
        }
        match name.as_str() {
            "a" => {
                if let Some(href) = extract_attr(inner, "href")
                    .and_then(|h| resolve_relative_url(&decode_entities(&h), base_url))
                {
                    let esc = href.replace('"', "&quot;");
                    out.push_str(&format!(
                        "<a href=\"{esc}\" target=\"_blank\" rel=\"noreferrer\">"
                    ));
                } else {
                    out.push_str("<span>");
                }
            }
            "img" => {
                if let Some(src) = extract_attr(inner, "src")
                    .and_then(|s| resolve_relative_url(&decode_entities(&s), base_url))
                {
                    let esc_src = src.replace('"', "&quot;");
                    let alt = extract_attr(inner, "alt")
                        .unwrap_or_default()
                        .replace('"', "&quot;");
                    out.push_str(&format!(
                        "<img src=\"{esc_src}\" alt=\"{alt}\" loading=\"lazy\" />"
                    ));
                }
            }
            "br" | "hr" => out.push_str(&format!("<{name} />")),
            _ => out.push_str(&format!("<{name}>")),
        }
    }
    out.push_str(&input[cur..]);
    out
}

fn extract_blocks(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(rel_start) = xml[cursor..].find(&open_prefix) {
        let start = cursor + rel_start;
        let after_name = start + open_prefix.len();
        if !matches!(
            xml.as_bytes().get(after_name).copied(),
            Some(b'>' | b' ' | b'\t' | b'\r' | b'\n')
        ) {
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
        if !matches!(
            block.as_bytes().get(after_name).copied(),
            Some(b'>' | b' ' | b'\t' | b'\r' | b'\n' | b'/')
        ) {
            cursor = after_name;
            continue;
        }
        let open_end_rel = block[after_name..].find('>')?;
        let header = &block[after_name..after_name + open_end_rel];
        if header.ends_with('/') {
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
    let mut stripped = String::with_capacity(decoded_once.len());
    let mut in_tag = false;
    for ch in decoded_once.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                stripped.push(' ');
            }
            _ if !in_tag => stripped.push(ch),
            _ => {}
        }
    }
    decode_entities(&stripped)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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

fn parse_date(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return Some(dt.with_timezone(&Utc).to_rfc3339());
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Some(dt.with_timezone(&Utc).to_rfc3339());
    }
    for (abbr, offset) in [
        (" EDT", " -0400"),
        (" EST", " -0500"),
        (" PDT", " -0700"),
        (" PST", " -0800"),
        (" GMT", " +0000"),
        (" UTC", " +0000"),
    ] {
        if let Some(prefix) = trimmed.strip_suffix(abbr) {
            if let Ok(dt) = DateTime::parse_from_rfc2822(&format!("{prefix}{offset}")) {
                return Some(dt.with_timezone(&Utc).to_rfc3339());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_opml_outlines() {
        let opml = r#"<opml version="2.0"><body>
          <outline text="Simon Willison" title="Simon Willison" xmlUrl="https://simonwillison.net/atom/everything/" htmlUrl="https://simonwillison.net/"/>
          <outline text="Folder"><outline text="Lil'Log" xmlUrl="https://lilianweng.github.io/index.xml"/></outline>
        </body></opml>"#;
        let items = parse_opml(opml);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].0, "Simon Willison");
        assert_eq!(items[1].1, "https://lilianweng.github.io/index.xml");
    }

    #[test]
    fn extracts_and_sanitizes_article_html() {
        let html = r#"<html><head><title>Deep Dive</title><script>alert(1)</script></head>
          <body><nav>menu</nav><article><h1>Deep Dive</h1><p onclick="evil()">Hello <a href="/doc">world</a></p></article></body></html>"#;
        let (title, clean, plain) = extract_readable_article(html, "https://example.com/post");
        assert_eq!(title, "Deep Dive");
        assert!(!clean.contains("alert(1)"));
        assert!(!clean.contains("onclick"));
        assert!(clean.contains("https://example.com/doc"));
        assert!(plain.contains("Hello world"));
    }
}
