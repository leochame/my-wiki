"""Freeze public daily price observations through the US 2026-11-05 close."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import hashlib
import json
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'raw'
RAW.mkdir(exist_ok=True)
SYMBOLS = ['^GSPC', '^NDX', '^IXIC', 'KO', 'GOOGL', '^VIX', '^TNX']
START = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp())
END = int(datetime(2026, 11, 6, tzinfo=timezone.utc).timestamp())


def fetch(symbol):
    name = symbol.replace('^', '')
    path = RAW / (name + '.json')
    params = {'period1': START, 'period2': END, 'interval': '1d', 'events': 'div,splits'}
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(symbol)
    if not path.exists():
        r = requests.get(url, params=params, headers={'User-Agent': 'Mozilla/5.0'}, timeout=45)
        r.raise_for_status()
        path.write_text(json.dumps(r.json(), ensure_ascii=False), encoding='utf-8')
    data = json.loads(path.read_text())['chart']['result'][0]
    times = pd.to_datetime(data['timestamp'], unit='s', utc=True)
    dates = times.tz_convert(data['meta']['exchangeTimezoneName']).tz_localize(None).normalize()
    out = pd.DataFrame(data['indicators']['quote'][0], index=dates)
    out.index.name = 'date'
    out['adjclose'] = data['indicators']['adjclose'][0]['adjclose']
    out = out.loc[:'2026-11-05'].dropna(subset=['close']).sort_index()
    assert not out.index.has_duplicates
    assert out['close'].gt(0).all()
    out.to_csv(ROOT / (name + '.csv'), float_format='%.10f')
    return {'symbol': symbol, 'name': name, 'url': url, 'params': params,
            'rows': len(out), 'first_date': str(out.index[0].date()),
            'last_date': str(out.index[-1].date()), 'last_close': float(out.close.iloc[-1]),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=7) as ex:
        records = list(ex.map(fetch, SYMBOLS))
    manifest = {'as_of': '2026-11-05 US regular close',
                'retrieved_utc': datetime.now(timezone.utc).isoformat(),
                'notes': 'Price-only close is used for every return model. Stock closes are split-adjusted; ordinary dividends excluded. Adjusted close is retained for audit only. Index daily timestamp commonly denotes session open, not time of close.',
                'data': records}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(records, ensure_ascii=False, indent=2))
