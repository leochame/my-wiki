export interface AcpProviderInfo {
  id: string;
  label: string;
  protocol: string;
  available: boolean;
  binary: string | null;
  detail: string;
}

export interface HealthResponse {
  app: string;
  port: number;
  vault_root: string;
  db_path: string;
  indexed_files: number;
  invest_ready?: boolean;
  northstar_url: string;
  northstar_online: boolean;
  providers: AcpProviderInfo[];
}

export interface TaskRecord {
  id: string;
  source: "by_task" | "todo";
  file_path: string;
  title: string;
  status: "todo" | "in-progress" | "waiting" | "done" | "cancelled" | string;
  due: string | null;
  priority: "low" | "medium" | "high" | "urgent" | string;
  category: string;
  notes: string;
  updated_at: string;
}

export interface ScriptDef {
  key: string;
  label: string;
  description: string;
  script_rel: string;
}

export interface ScriptRunRecord {
  id: number;
  script_key: string;
  command: string;
  status: "running" | "ok" | "error" | string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary_json: string | null;
  output_log: string;
}

export interface TodayBlogLink {
  title: string;
  url: string;
  provider: string;
  meta: string;
}

export interface TodayBrief {
  exists: boolean;
  date_heading: string | null;
  whv_lines: string[];
  whv_alert: boolean;
  blog_links: TodayBlogLink[];
  raw_markdown: string;
}

export interface NorthstarAccountSummary {
  total_equity: string;
  cash_balance: string;
  day_pnl?: string | null;
  day_pnl_pct?: string | null;
  unrealized_pnl?: string | null;
  unrealized_pnl_pct?: string | null;
  positions_count?: number;
  currency?: string;
}

export interface FinanceBriefSummary {
  generated_at: string;
  item_count: number;
  markdown: string;
  mailed_to?: string | null;
}

export interface GmailEmail {
  account: string;
  account_email: string;
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  labels?: string[];
  url: string;
}

export interface GmailAccountDigest {
  name: string;
  email: string;
  emails: GmailEmail[];
}

export interface GmailDigest {
  fetched_at?: string;
  total_unread?: number;
  accounts: GmailAccountDigest[];
  errors?: string[];
}

export interface JobWatchItem {
  title: string;
  url: string;
  location?: string | null;
  posted_at?: string | null;
  team?: string | null;
  job_id?: string | null;
  is_new?: boolean;
}

export interface JobWatchCompany {
  company: string;
  source_url?: string | null;
  warning?: string | null;
  new_count?: number;
  jobs: JobWatchItem[];
}

export interface JobWatchReport {
  generated_at: string;
  keyword: string;
  location: string;
  limit: number;
  total_jobs: number;
  total_new: number;
  companies: JobWatchCompany[];
}

export interface EmailScriptConfig {
  to_addresses: string;
  max_unread: number;
  auto_send_brief: boolean;
}

export interface JobWatchConfig {
  companies: string[];
  keyword: string;
  location: string;
  limit: number;
}

export interface CalendarSyncConfig {
  mode: "bidirectional" | "push" | "status" | string;
  google_enabled: boolean;
  google_calendar_name: string;
  google_tasklist_name: string;
  apple_enabled: boolean;
  apple_calendar_name: string;
  include_completed: boolean;
}

export interface ScriptSettings {
  email: EmailScriptConfig;
  jobs: JobWatchConfig;
  calendar: CalendarSyncConfig;
}

export interface ScriptSettingsResponse {
  settings: ScriptSettings;
  mail_env_configured: boolean;
  google_oauth_configured: boolean;
  ics_url: string;
}

export interface TodayResponse {
  date: string;
  due_today: TaskRecord[];
  overdue: TaskRecord[];
  upcoming_7d: TaskRecord[];
  todo_open_count: number;
  total_open_count: number;
  brief: TodayBrief;
  scripts: ScriptDef[];
  running_scripts: string[];
  recent_runs: ScriptRunRecord[];
  northstar_account: NorthstarAccountSummary | null;
  finance_summary: FinanceBriefSummary | null;
  gmail_digest: GmailDigest | null;
  job_watch: JobWatchReport | null;
}

export interface VaultFileRecord {
  path: string;
  area: string;
  title: string;
  frontmatter_json: string;
  tags: string[];
  word_count: number;
  mtime: number;
  content_hash: string;
  indexed_at: string;
}

export interface WikilinkRecord {
  source_path: string;
  target_raw: string;
  resolved_path: string | null;
  alias: string | null;
}

export interface VaultFileDetail {
  path: string;
  area: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  word_count: number;
  mtime: number;
  outgoing: WikilinkRecord[];
  backlinks: WikilinkRecord[];
}

export interface SearchHit {
  path: string;
  area: string;
  title: string;
  snippet: string;
  tags: string[];
  mtime: number;
}

export interface FeedSourceRecord {
  id: string;
  name: string;
  group_name: string;
  kind: string;
  feed_url: string;
  site_url: string;
  description?: string;
  enabled: boolean;
  last_ok: boolean;
  last_error: string | null;
  last_fetched_at: string | null;
}

export interface FeedItemRecord {
  id: string;
  source_id: string;
  source_name: string;
  group_name: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  saved_note_path: string | null;
  fetched_at: string;
}

export interface FeedsResponse {
  sources: FeedSourceRecord[];
  items: FeedItemRecord[];
}

export interface ReaderResponse {
  status: "ok" | "blocked";
  reason: string | null;
  url: string;
  title: string;
  byline: string | null;
  clean_html: string;
  plain_text: string;
  word_count: number;
  fetched_at: string;
}

export interface HighlightRecord {
  id: number;
  url: string;
  page_title: string;
  excerpt: string;
  comment: string;
  linked_doc_path: string | null;
  created_at: string;
}

export interface AcpSessionRecord {
  session_id: string;
  provider: string;
  external_session_id: string | null;
  title: string;
  cwd: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AcpEventRecord {
  id: number;
  session_id: string;
  seq: number;
  kind: "user" | "assistant" | "tool_call" | "error" | string;
  payload_json: string;
  created_at: string;
}
