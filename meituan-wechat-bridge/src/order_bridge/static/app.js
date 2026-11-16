"use strict";

let token = "";
let selectedState = "";
let currentStatus = null;
let refreshBusy = false;
const $ = (selector) => document.querySelector(selector);
const labels = {
  pending: ["待处理", "waiting"], leased: ["已领取", "blue"],
  sending: ["处理中", "blue"], retry: ["等待重试", "waiting"],
  simulated: ["模拟完成", "good"], sent: ["已提交发送", "good"],
  uncertain: ["待核对", "waiting"], dead: ["失败", "bad"], suppressed: ["已停止", "neutral"],
};

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function notice(message, error = false) {
  const node = $("#notice");
  node.textContent = message;
  node.className = error ? "notice error" : "notice";
  node.hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {"Content-Type": "application/json", ...(token ? {Authorization: `Bearer ${token}`} : {}), ...options.headers},
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !$("#login-dialog").open) $("#login-dialog").showModal();
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
  }
  return body;
}

function statusTag(state) {
  const [label, style] = labels[state] || [state, "neutral"];
  return element("span", label, `tag ${style}`);
}

function dateString(seconds) {
  return new Date(seconds * 1000).toLocaleString("zh-CN", {month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"});
}

function renderJobs(jobs) {
  const tbody = $("#jobs");
  tbody.replaceChildren();
  $("#empty").hidden = jobs.length !== 0;
  $("#queue-count").textContent = `${jobs.length} 条`;
  for (const job of jobs) {
    const row = element("tr");
    const orderCell = element("td");
    orderCell.append(element("div", `${job.event === "cancelled" ? "取消" : "接单"} · ${job.order_id}`, "order-main"));
    const items = job.payload.items.map((item) => `${item.name} × ${item.quantity}`).join("，");
    orderCell.append(element("div", items || job.payload.remark || "订单状态更新", "order-sub"));
    const stateCell = element("td");
    stateCell.append(statusTag(job.state));
    const actionCell = element("td");
    const detail = element("button", "查看 →", "button secondary");
    detail.addEventListener("click", (event) => {event.stopPropagation(); openJob(job.id).catch((error) => notice(error.message, true));});
    actionCell.append(detail);
    row.append(orderCell, element("td", job.payload.store_name || job.store_id), element("td", job.target.group_name), stateCell, element("td", dateString(job.created_at)), actionCell);
    row.addEventListener("click", () => openJob(job.id).catch((error) => notice(error.message, true)));
    tbody.append(row);
  }
}

function renderRoutes(routes) {
  $("#route-count").textContent = `${Object.keys(routes).length} 家门店`;
  const container = $("#route-list");
  container.replaceChildren();
  for (const [store, route] of Object.entries(routes)) {
    const row = element("div", undefined, "route-item");
    row.append(element("code", store), element("span", route.group_name));
    container.append(row);
  }
  if (!Object.keys(routes).length) container.append(element("p", "添加第一家门店，配置订单的通知去向。"));
}

async function refresh() {
  if (refreshBusy || $("#login-dialog").open) return;
  refreshBusy = true;
  try {
    const [status, jobs, routes] = await Promise.all([
      api("/api/status"), api(`/api/jobs?limit=100${selectedState ? `&state=${encodeURIComponent(selectedState)}` : ""}`), api("/api/routes"),
    ]);
    currentStatus = status;
    $("#environment").textContent = status.demo ? "演示环境 · 不发送微信" : "服务运行中 · 微信待接入";
    $("#add-demo").hidden = !status.demo;
    $("#metric-total").textContent = status.total;
    $("#metric-pending").textContent = status.counts.pending + status.counts.retry;
    $("#metric-simulated").textContent = status.counts.simulated;
    $("#metric-attention").textContent = status.counts.dead + status.counts.uncertain;
    $("#connection-state").textContent = status.demo ? "模拟订单入口已就绪" : (status.brand_callback_configured ? "品牌商回调已配置，等待联调" : "等待配置订单来源");
    const activeWorkers = status.workers.filter((worker) => Date.now() / 1000 - worker.last_seen < 30);
    $("#worker-state").textContent = activeWorkers.length ? `${activeWorkers.length} 个发送端在线` : "尚无在线发送端";
    $("#brand-state").textContent = status.brand_callback_configured ? "已配置，待联调" : "未配置";
    $("#brand-state").className = `tag ${status.brand_callback_configured ? "good" : "neutral"}`;
    $("#updated-at").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN")}`;
    renderJobs(jobs);
    renderRoutes(routes);
  } catch (error) {
    if (!$("#login-dialog").open) notice(`连接失败：${error.message}`, true);
  } finally {refreshBusy = false;}
}

async function perform(path, body = {}) {
  const result = await api(path, {method: "POST", body: JSON.stringify(body)});
  await refresh();
  return result;
}

async function openJob(id) {
  const job = await api(`/api/jobs/${id}`);
  const meta = $("#job-meta");
  meta.replaceChildren();
  meta.append(statusTag(job.state), element("div", `目标群：${job.target.group_name}`), element("div", `订单：${job.order_id} · 已尝试 ${job.attempts} 次`));
  $("#job-message").textContent = job.message;
  $("#job-error").textContent = job.last_error;
  $("#job-history").replaceChildren();
  for (const entry of job.history || []) {
    const item = element("p");
    item.append(element("small", dateString(entry.created_at)), element("span", entry.note));
    $("#job-history").append(item);
  }
  const actions = $("#job-actions");
  actions.replaceChildren();
  function addAction(label, path, body = {}) {
    const button = element("button", label, "button secondary");
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {await perform(path, body); $("#job-dialog").close(); notice("任务状态已更新。");}
      catch (error) {$("#job-error").textContent = error.message;}
      finally {button.disabled = false;}
    });
    actions.append(button);
  }
  if (currentStatus?.demo && job.event === "confirmed") addAction("模拟订单取消", `/api/demo/jobs/${id}/cancel`);
  if (["dead", "retry"].includes(job.state)) addAction("重新入队", `/api/jobs/${id}/retry`);
  if (job.state === "uncertain") {
    addAction("已核对未发送，重新入队", `/api/jobs/${id}/retry`, {confirmed_unsent: true});
    if (job.mode !== "mock") addAction("已核对发送成功", `/api/jobs/${id}/resolve`, {outcome: "sent"});
    addAction("停止这条通知", `/api/jobs/${id}/resolve`, {outcome: "suppressed"});
  }
  if (!$("#job-dialog").open) $("#job-dialog").showModal();
}

$("#close-detail").addEventListener("click", () => $("#job-dialog").close());
$("#refresh").addEventListener("click", refresh);
$("#add-demo").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {await perform("/api/demo/orders"); notice("模拟订单已进入队列，模拟发送端将自动处理。");}
  catch (error) {notice(error.message, true);}
  finally {button.disabled = false;}
});
$("#route-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/routes/${encodeURIComponent(form.get("store_id").trim())}`, {method: "PUT", body: JSON.stringify({group_name: form.get("group_name").trim()})});
    notice("路由已保存，将用于之后进入的新订单。"); event.target.reset(); await refresh();
  } catch (error) {notice(error.message, true);}
});
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  token = $("#api-token").value;
  try {await api("/api/status"); $("#login-dialog").close(); $("#api-token").value = ""; $("#login-error").textContent = ""; await refresh();}
  catch {token = ""; $("#login-error").textContent = "连接失败，请核对令牌和服务状态。";}
});
for (const button of document.querySelectorAll(".filters button")) button.addEventListener("click", () => {
  selectedState = button.dataset.state;
  for (const other of document.querySelectorAll(".filters button")) other.classList.toggle("selected", other === button);
  refresh();
});
for (const link of document.querySelectorAll("nav a")) link.addEventListener("click", () => {
  for (const other of document.querySelectorAll("nav a")) other.classList.toggle("active", other === link);
});
refresh();
setInterval(refresh, 4000);
