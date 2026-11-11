"""Update frozen 2026-11-06 analysis using only subsequently observed closes.

Keeps the original 2027-02-05 terminal date and subjective price scenarios fixed.
Reuses the previous risk model; does not rerun or retune its completed backtest.
Requires numpy, pandas, matplotlib, requests. Run from any directory.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import hashlib
import importlib.util
import json

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parent / '三个月走势模型-2026-11-06'
RAW = ROOT / 'raw'
OUT = ROOT / 'results'
RAW.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
AS_OF = pd.Timestamp('2026-11-09')
TARGET = pd.Timestamp('2027-02-05')
OLD_AS_OF = pd.Timestamp('2026-11-05')
SYMBOLS = ['^GSPC', '^NDX', '^IXIC', 'KO', 'GOOGL', '^VIX', '^TNX', 'NVDA']


def fetch(symbol):
    name = symbol.replace('^', '')
    path = RAW / (name+'.json')
    params = {'period1': int(datetime(2026,10,1,tzinfo=timezone.utc).timestamp()),
              'period2': int(datetime(2026,11,10,tzinfo=timezone.utc).timestamp()),
              'interval':'1d','events':'div,splits'}
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol)
    if not path.exists():
        response=requests.get(url,params=params,headers={'User-Agent':'Mozilla/5.0'},timeout=45)
        response.raise_for_status()
        path.write_text(json.dumps(response.json(),ensure_ascii=False))
    item=json.loads(path.read_text())['chart']['result'][0]
    dates=pd.to_datetime(item['timestamp'],unit='s',utc=True)
    dates=dates.tz_convert(item['meta']['exchangeTimezoneName']).tz_localize(None).normalize()
    frame=pd.DataFrame(item['indicators']['quote'][0],index=dates).sort_index()
    frame.index.name='date'
    frame=frame.loc[:AS_OF].dropna(subset=['close'])
    assert not frame.index.has_duplicates and frame.close.gt(0).all()
    assert frame.index[-1]==AS_OF, name
    frame.to_csv(ROOT/(name+'.csv'),float_format='%.10f')
    meta={'symbol':symbol,'name':name,'url':url,'params':params,
          'first_date':str(frame.index[0].date()),'last_date':str(frame.index[-1].date()),
          'last_close':float(frame.close.iloc[-1]),'raw_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    return name,frame.close.rename(name),meta


def main():
    with ThreadPoolExecutor(max_workers=8) as ex:
        fetched=list(ex.map(fetch,SYMBOLS))
    new={name:series for name,series,_ in fetched}
    meta=[item for _,_,item in fetched]
    spec=importlib.util.spec_from_file_location('previous_price_model',PREVIOUS/'model.py')
    model=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    names=model.ASSETS
    combined={}
    revisions=[]
    for name in names+['IXIC','VIX','TNX']:
        old=pd.read_csv(PREVIOUS/(name+'.csv'),parse_dates=['date']).set_index('date').close
        old=old.loc[:OLD_AS_OF]
        common=old.index.intersection(new[name].index)
        relative_difference=(new[name].loc[common]/old.loc[common]-1).abs()
        revisions.append({'asset':name,'overlap_rows':len(common),
                          'max_overlap_close_revision_fraction':float(relative_difference.max())})
        # Earlier predictions retain their original input history; append new dates.
        combined[name]=pd.concat([old,new[name].loc[new[name].index>OLD_AS_OF]]).rename(name)
        assert not combined[name].index.has_duplicates
    prices=pd.concat([combined[s] for s in names+['IXIC']],axis=1).dropna()
    returns=np.log(prices).diff().dropna()
    vix=combined['VIX'].reindex(prices.index,method='ffill')
    future=pd.bdate_range(AS_OF+pd.Timedelta(days=1),TARGET).difference(model.HOLIDAYS)
    model.HORIZON=len(future)
    assert model.HORIZON==60
    logs,state=model.simulate(returns[names],float(vix.iloc[-1]),samples=20000,seed=model.SEED)
    mu,sigma,beta,_=state
    forecasts=[]
    curves=[]
    snapshot=[]
    for k,name in enumerate(names):
        end=logs[:,-1,k]
        quantiles=np.quantile(end,[.1,.5,.9])
        current=float(prices[name].iloc[-1])
        forecasts.append({'asset':name,'current_price':current,'horizon_sessions':model.HORIZON,
                           'annual_vol':float(sigma[k]*np.sqrt(252)),
                           'beta_252_to_SP500':float(beta[k]),
                           **{f'p{n}_price':float(current*np.exp(quantiles[j])) for j,n in enumerate([10,50,90])}})
        q=np.quantile(logs[:,:,k],[.1,.5,.9],axis=0)
        for j,date in enumerate(future):
            curves.append({'asset':name,'date':str(date.date()),
                            **{f'p{n}':float(current*np.exp(q[l,j])) for l,n in enumerate([10,50,90])}})
    for name in names+['IXIC']:
        series=prices[name]
        oldprice=float(series.loc[OLD_AS_OF])
        current=float(series.iloc[-1])
        snapshot.append({'asset':name,'close':current,'close_11_05':oldprice,
                          'return_since_11_05':current/oldprice-1,
                          'return_1d':current/series.iloc[-2]-1,
                          'return_21d':current/series.iloc[-22]-1,
                          'SMA50':series.tail(50).mean(),'SMA200':series.tail(200).mean(),
                          'vs_SMA50':current/series.tail(50).mean()-1,
                          'vs_SMA200':current/series.tail(200).mean()-1})
    forecasts=pd.DataFrame(forecasts)
    forecasts.to_csv(OUT/'conditional_forecast.csv',index=False)
    pd.DataFrame(curves).to_csv(OUT/'forecast_curves.csv',index=False)
    pd.DataFrame(snapshot).to_csv(OUT/'market_snapshot.csv',index=False)
    pd.DataFrame(revisions).to_csv(OUT/'vendor_overlap_revisions.csv',index=False)
    old_scenarios=pd.read_csv(PREVIOUS/'results/news_scenarios.csv')
    comparison=[]
    for _,row in old_scenarios.iterrows():
        current=float(prices[row.asset].iloc[-1])
        comparison.append({'asset':row.asset,'scenario':row.scenario,
                            'original_terminal_price':row.terminal_price,
                            'current_price':current,
                            'remaining_return_to_original_scenario':row.terminal_price/current-1})
    pd.DataFrame(comparison).to_csv(OUT/'original_scenarios_comparison.csv',index=False)
    old_forecasts=pd.read_csv(PREVIOUS/'results/forecast.csv')
    changes=forecasts.merge(old_forecasts[['asset','sigma_annual','p10_price','p50_price','p90_price']],
                           on='asset',suffixes=('_now','_previous'))
    changes.to_csv(OUT/'risk_model_change.csv',index=False)
    dependencies={}
    for name in [*names,'IXIC','VIX','TNX']:
        filename=name+'.csv'
        dependencies[str((PREVIOUS/filename).relative_to(ROOT.parent))]=hashlib.sha256((PREVIOUS/filename).read_bytes()).hexdigest()
    dependencies[str((PREVIOUS/'model.py').relative_to(ROOT.parent))]=hashlib.sha256((PREVIOUS/'model.py').read_bytes()).hexdigest()
    (ROOT/'manifest.json').write_text(json.dumps({
        'retrieved_at_utc':datetime.now(timezone.utc).isoformat(),
        'as_of':str(AS_OF.date()),'target':str(TARGET.date()),'remaining_sessions':model.HORIZON,
        'mode':'Append only; keep previous subjective terminal scenarios unchanged; reuse model with no new backtest or tuning.',
        'data':meta,'previous_data_and_model_sha256':dependencies,
        'VIX_previous':float(combined['VIX'].loc[OLD_AS_OF]),'VIX_current':float(vix.iloc[-1]),
        'notes':'Stock/index closes only through 11-09; no CPI or US 11-10 close. Old vendor observations retained; overlaps checked separately. USD price returns exclude dividends, taxes and FX.'
    },ensure_ascii=False,indent=2))
    for _,row in forecasts.iterrows():
        assert row.p10_price<row.p50_price<row.p90_price
    assert prices.index[-1]==AS_OF

    model.plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,
        'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white'})
    fig,axes=model.plt.subplots(2,2,figsize=(12,8),constrained_layout=True)
    curve=pd.DataFrame(curves)
    for ax,name in zip(axes.flat,names):
        past=prices[name].loc['2026-10-01':]
        c=curve[curve.asset.eq(name)]
        dates=pd.to_datetime(c.date)
        ax.plot(past.index,past,color='#263e50',label='Observed close')
        ax.fill_between(dates,c.p10.to_numpy(),c.p90.to_numpy(),alpha=.15,color='#3378b8',label='Updated P10-P90')
        ax.plot(dates,c.p50,color='#3378b8',label='Updated median')
        original_base=old_scenarios[(old_scenarios.asset==name)&(old_scenarios.scenario=='base')].terminal_price.iloc[0]
        ax.axhline(original_base,color='#cc8d27',ls='--',lw=1,label='Original subjective base')
        ax.axvline(AS_OF,color='#999',ls=':',lw=1)
        ax.set_title(model.LABELS[name])
        ax.tick_params(axis='x',rotation=25)
        ax.grid(alpha=.15)
    axes[0,0].legend(frameon=False,fontsize=8)
    fig.suptitle('Update through 2026-11-09 close | same terminal date: 2027-02-05',fontsize=14)
    fig.savefig(ROOT/'update.png',dpi=160)
    fig.savefig(ROOT/'update.pdf')
    model.plt.close(fig)
    print('MARKET\n'+pd.DataFrame(snapshot).to_string(index=False))
    print('\nFORECAST\n'+forecasts.to_string(index=False))
    print('\nORIGINAL BASE SCENARIOS\n'+pd.DataFrame(comparison).query("scenario=='base'").to_string(index=False))
    print('\nOVERLAP DATA\n'+pd.DataFrame(revisions).to_string(index=False))


if __name__=='__main__':
    main()
