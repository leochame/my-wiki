const $ = (id) => document.getElementById(id);
let pendingOrder = null;
let liveMode = false;

function drawChart(candles) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!candles.length) return;
  const values = candles.map((c) => Number(c.close));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 24;
  const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / Math.max(0.0001, max - min)) * (height - pad * 2);
  ctx.strokeStyle = "#75d6c6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  values.forEach((value, i) => i ? ctx.lineTo(x(i), y(value)) : ctx.moveTo(x(i), y(value)));
  ctx.stroke();
  ctx.fillStyle = "#8d9bad";
  ctx.font = "12px system-ui";
  ctx.fillText(max.toFixed(2), 8, pad);
  ctx.fillText(min.toFixed(2), 8, height - pad);
}

async function loadMarket() {
  const symbol = $("symbol").value.trim().toUpperCase();
  if (!symbol) return;
  $("chart-state").textContent = "加载中";
  try {
    const [quoteResponse, candlesResponse] = await Promise.all([
      fetch(`/api/quotes/${encodeURIComponent(symbol)}`),
      fetch(`/api/candles/${encodeURIComponent(symbol)}?count=60`),
    ]);
    if (!quoteResponse.ok || !candlesResponse.ok) throw new Error("行情接口未配置或请求失败");
    const quote = await quoteResponse.json();
    const candles = await candlesResponse.json();
    $("quote-symbol").textContent = quote.symbol;
    $("quote-source").textContent = quote.source;
    $("last").textContent = quote.last;
    $("change").textContent = quote.previous_close ? `前收 ${quote.previous_close}` : "—";
    $("open").textContent = quote.open ?? "—";
    $("high").textContent = quote.high ?? "—";
    $("low").textContent = quote.low ?? "—";
    $("volume").textContent = quote.volume ?? "—";
    $("chart-state").textContent = `${candles.length} 根 K 线`;
    drawChart(candles);
  } catch (error) {
    $("chart-state").textContent = error.message;
  }
}

$("load").addEventListener("click", loadMarket);
$("symbol").addEventListener("keydown", (event) => { if (event.key === "Enter") loadMarket(); });
$("order-type").addEventListener("change", (event) => $("limit-wrap").classList.toggle("hidden", event.target.value !== "limit"));
$("order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const order = {
    symbol: $("symbol").value.trim().toUpperCase(),
    side: $("side").value,
    quantity: $("quantity").value,
    order_type: $("order-type").value,
  };
  if (order.order_type === "limit") order.limit_price = $("limit-price").value;
  const response = await fetch("/api/orders/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) });
  const body = await response.json();
  if (!response.ok) {
    $("order-result").textContent = JSON.stringify(body, null, 2);
    return;
  }
  pendingOrder = order;
  $("submit-order").classList.remove("hidden");
  $("order-result").textContent = JSON.stringify(body, null, 2);
});

$("submit-order").addEventListener("click", async () => {
  if (!pendingOrder) return;
  const payload = { ...pendingOrder };
  if (liveMode) payload.confirmation = $("confirmation").value;
  const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  $("order-result").textContent = JSON.stringify(body, null, 2);
  if (response.ok) {
    pendingOrder = null;
    $("submit-order").classList.add("hidden");
    $("confirmation").value = "";
  }
});

(async () => {
  try {
    const health = await fetch("/api/health").then((response) => response.json());
    liveMode = health.trading_mode === "live";
    $("confirmation-wrap").classList.toggle("hidden", !liveMode);
    $("mode").textContent = `${health.trading_mode} · ${health.market_data_provider}`;
  } catch (_) { $("mode").textContent = "后端未连接"; }
  loadMarket();
})();
