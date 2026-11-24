import type {
  AcpEventRecord,
  AcpProviderInfo,
  AcpSessionRecord,
  FeedSourceRecord,
  FeedsResponse,
  HealthResponse,
  HighlightRecord,
  ReaderResponse,
  ScriptRunRecord,
  ScriptSettings,
  ScriptSettingsResponse,
  SearchHit,
  TaskRecord,
  TodayResponse,
  VaultFileDetail,
  VaultFileRecord,
} from "../types";

async function req<T>(url: string, options?: RequestInit, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }).catch(() => {
    throw new Error("无法连接 MyWiki Studio 本地服务或请求超时");
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `请求失败 (${res.status})`);
  return body as T;
}

const send = <T>(method: "POST" | "PUT" | "PATCH", url: string, payload?: unknown, timeoutMs = 25000) =>
  req<T>(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    },
    timeoutMs,
  );

export const getHealth = () => req<HealthResponse>("/api/health");
export const getToday = () => req<TodayResponse>("/api/today");

export const runScript = (key: string) =>
  send<ScriptRunRecord>("POST", `/api/scripts/${encodeURIComponent(key)}/run`, {}, 240000);
export const listScriptRuns = () => req<ScriptRunRecord[]>("/api/scripts/runs");
export const getScriptStatus = () => req<{ running: string[] }>("/api/scripts/status");
export const getScriptConfig = () => req<ScriptSettingsResponse>("/api/scripts/config");
export const updateScriptConfig = (settings: ScriptSettings) =>
  send<ScriptSettingsResponse>("PUT", "/api/scripts/config", settings);

export const listTasks = () => req<TaskRecord[]>("/api/tasks");
export const resyncTasks = () => send<TaskRecord[]>("POST", "/api/tasks/resync");
export const createTask = (payload: {
  title: string;
  source: "by_task" | "todo";
  status?: string;
  due?: string;
  priority?: string;
  category?: string;
  notes?: string;
  description?: string;
}) => send<TaskRecord>("POST", "/api/tasks", payload);
export const updateTask = (
  id: string,
  payload: {
    title?: string;
    status?: string;
    due?: string;
    priority?: string;
    category?: string;
    notes?: string;
  },
) => send<TaskRecord>("PATCH", `/api/tasks/${encodeURIComponent(id)}`, payload);
export const promoteTask = (id: string, payload: { due: string; priority?: string }) =>
  send<TaskRecord>("POST", `/api/tasks/${encodeURIComponent(id)}/promote`, payload);

export const listVaultFiles = (area?: string) =>
  req<VaultFileRecord[]>(area ? `/api/vault/files?area=${encodeURIComponent(area)}` : "/api/vault/files");
export const reindexVault = () => send<{ indexed_files: number; tasks_count: number }>("POST", "/api/vault/reindex");
export const searchVault = (q: string, area?: string) => {
  const qs = new URLSearchParams({ q });
  if (area) qs.set("area", area);
  return req<SearchHit[]>(`/api/vault/search?${qs.toString()}`);
};
export const getVaultFile = (path: string) =>
  req<VaultFileDetail>(`/api/vault/file?path=${encodeURIComponent(path)}`);
export const saveVaultFile = (path: string, content: string) =>
  send<VaultFileDetail>("PUT", "/api/vault/file", { path, content });
export const createVaultFile = (payload: {
  folder: string;
  title: string;
  tags?: string[];
  body?: string;
}) => send<VaultFileDetail>("POST", "/api/vault/file", payload);

export const listFeeds = (params?: {
  group?: string;
  source_id?: string;
  unread?: boolean;
  starred?: boolean;
  q?: string;
  limit?: number;
}) => {
  const qs = new URLSearchParams();
  if (params?.group) qs.set("group", params.group);
  if (params?.source_id) qs.set("source_id", params.source_id);
  if (params?.unread) qs.set("unread", "true");
  if (params?.starred) qs.set("starred", "true");
  if (params?.q) qs.set("q", params.q);
  if (params?.limit) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return req<FeedsResponse>(s ? `/api/feeds?${s}` : "/api/feeds");
};
export const refreshFeeds = () => send<{ processed: number }>("POST", "/api/feeds/refresh", {}, 45000);
export const addFeedSource = (payload: {
  name: string;
  group_name: string;
  feed_url: string;
  site_url?: string;
}) => send<FeedSourceRecord>("POST", "/api/feeds/sources", payload, 25000);
export const toggleFeedSource = (id: string, enabled: boolean) =>
  send<{ ok: boolean }>("PATCH", `/api/feeds/sources/${encodeURIComponent(id)}`, { enabled });
export const deleteFeedSource = (id: string) =>
  req<{ ok: boolean }>(`/api/feeds/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
export const importOpml = (opml_xml: string, group_name: string) =>
  send<{ imported: number }>("POST", "/api/feeds/import-opml", { opml_xml, group_name }, 30000);
export const patchFeedItem = (id: string, payload: { is_read?: boolean; is_starred?: boolean }) =>
  send<{ ok: boolean }>("PATCH", `/api/feeds/items/${encodeURIComponent(id)}`, payload);

export const fetchReader = (url: string, force = false) =>
  req<ReaderResponse>(
    `/api/reader?url=${encodeURIComponent(url)}${force ? "&force=true" : ""}`,
    undefined,
    20000,
  );
export const archiveArticle = (payload: {
  url: string;
  title: string;
  source_name?: string;
  summary?: string;
  highlights?: string[];
  feed_item_id?: string;
}) => send<{ path: string }>("POST", "/api/reader/archive", payload);
export const listHighlights = (url?: string) =>
  req<HighlightRecord[]>(url ? `/api/reader/highlights?url=${encodeURIComponent(url)}` : "/api/reader/highlights");
export const addHighlight = (payload: {
  url: string;
  page_title: string;
  excerpt: string;
  comment?: string;
  linked_doc_path?: string;
}) => send<HighlightRecord>("POST", "/api/reader/highlights", payload);

export const listAcpProviders = () => req<AcpProviderInfo[]>("/api/acp/providers");
export const listAcpSessions = () => req<AcpSessionRecord[]>("/api/acp/sessions");
export const createAcpSession = (provider: string, title?: string) =>
  send<AcpSessionRecord>("POST", "/api/acp/sessions", { provider, title: title ?? "" });
export const deleteAcpSession = (sessionId: string) =>
  req<{ ok: boolean }>(`/api/acp/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
export const listAcpEvents = (sessionId: string) =>
  req<AcpEventRecord[]>(`/api/acp/sessions/${encodeURIComponent(sessionId)}/events`);
export const revertAcpSession = (sessionId: string, fromEventId: number) =>
  send<{ deleted: number; events: AcpEventRecord[] }>(
    "POST",
    `/api/acp/sessions/${encodeURIComponent(sessionId)}/revert`,
    { from_event_id: fromEventId },
  );

export function acpWsUrl(sessionId: string) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/acp/${encodeURIComponent(sessionId)}`;
}
