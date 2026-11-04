"""Freeze daily, dividend/split-adjusted Yahoo data for this study.

Usage: python download_data.py
The fixed cutoff excludes US trading on 2026-10-29. Existing snapshots are kept.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
RAW.mkdir(exist_ok=True)
SYMBOLS = ["SPY", "QQQ", "BRK-B", "VOO", "QQQM"]
START = int(datetime(1999, 1, 1, tzinfo=timezone.utc).timestamp())
END = int(datetime(2026, 10, 29, tzinfo=timezone.utc).timestamp())


def download(symbol):
    filename = RAW / (symbol.replace("=", "_") + ".json")
    params = {"period1": START, "period2": END, "interval": "1d", "events": "div,splits"}
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + symbol
    if not filename.exists():
        response = requests.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
        response.raise_for_status()
        payload = response.json()
        if payload["chart"]["error"]:
            raise RuntimeError(payload["chart"]["error"])
        filename.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    payload = json.loads(filename.read_text(encoding="utf-8"))
    data = payload["chart"]["result"][0]
    # FX midnight timestamps can fall on the previous UTC date. Use exchange dates.
    dates = pd.to_datetime(data["timestamp"], unit="s", utc=True)
    dates = dates.tz_convert(data["meta"]["exchangeTimezoneName"]).tz_localize(None).normalize()
    out = pd.DataFrame({
        "date": dates,
        "close": data["indicators"]["quote"][0]["close"],
        "adjclose": data["indicators"]["adjclose"][0]["adjclose"],
    }).dropna().drop_duplicates("date", keep="last")
    # Some FX responses include a current observation beyond period2.
    out = out[out["date"] <= "2026-10-28"]
    if (out[["close", "adjclose"]] <= 0).any().any():
        raise ValueError(f"Nonpositive price in {symbol}")
    out.to_csv(ROOT / (symbol.replace("=", "_") + ".csv"), index=False, float_format="%.10f")
    return {
        "symbol": symbol, "url": url, "query": params,
        "rows": len(out), "first_date": str(out["date"].iloc[0].date()),
        "last_date": str(out["date"].iloc[-1].date()),
        "last_close": float(out["close"].iloc[-1]),
        "exchange_timezone": data["meta"]["exchangeTimezoneName"],
        "raw_sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
    }


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=6) as pool:
        manifest = list(pool.map(download, SYMBOLS))
    fed_url = "https://www.federalreserve.gov/releases/h10/hist/dat00_ch.htm"
    fed_path = RAW / "fed.html"
    if not fed_path.exists():
        response = requests.get(fed_url, timeout=60)
        response.raise_for_status()
        fed_path.write_bytes(response.content)
    table = BeautifulSoup(fed_path.read_text(encoding="utf-8"), "html.parser").find("table", class_="pubtables")
    rates = []
    for row in table.find_all("tr"):
        cells = row.find_all(["th", "td"])
        if len(cells) == 2:
            date, rate = [cell.get_text(strip=True) for cell in cells]
            try:
                rates.append((datetime.strptime(date, "%d-%b-%y").date(), float(rate)))
            except ValueError:  # Header and ND (no observation) rows.
                continue
    fx = pd.DataFrame(rates, columns=["date", "CNY_per_USD"]).set_index("date").sort_index()
    fx = fx.loc[:datetime(2026, 10, 28).date()]
    if fx.empty or fx.index.has_duplicates or not fx.CNY_per_USD.between(4, 10).all():
        raise ValueError("Invalid H.10 FX data")
    fx.to_csv(ROOT / "FED_USDCNY.csv")
    manifest.append({"symbol": "FED_USDCNY", "url": fed_url, "rows": len(fx),
                     "first_date": str(fx.index[0]), "last_date": str(fx.index[-1]),
                     "last_close": float(fx.CNY_per_USD.iloc[-1]),
                     "raw_sha256": hashlib.sha256(fed_path.read_bytes()).hexdigest()})
    (ROOT / "manifest.json").write_text(json.dumps({
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "as_of": "2026-10-28 US close", "data": manifest,
        "notes": "Adjusted closes are an approximate gross-dividend-reinvestment series; no personal taxes or transaction/FX costs. Historical data can be revised by the vendor. FX uses Federal Reserve H.10 noon reference rates, not bank execution quotes. Yahoo CNY=X and ECB downloads are NOT used in calculations.",
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
