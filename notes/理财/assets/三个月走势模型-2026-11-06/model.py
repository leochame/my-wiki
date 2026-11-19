"""Price-only three-month forecasts, time-ordered evaluation, explicit news scenarios.

Run using numpy, pandas and matplotlib. No trading or account access.
Frozen histories from download.py are never edited by this script.
"""
from pathlib import Path
import json
import math
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'results'
OUT.mkdir(exist_ok=True)
ASSETS = ['GSPC', 'NDX', 'KO', 'GOOGL']
ALL_PRICE = ASSETS + ['IXIC']
LABELS = {'GSPC':'S&P 500', 'NDX':'Nasdaq-100', 'KO':'Coca-Cola', 'GOOGL':'Alphabet A'}
AS_OF = pd.Timestamp('2026-11-05')
TARGET = pd.Timestamp('2027-02-05')
HOLIDAYS = pd.to_datetime(['2026-11-26','2026-12-25','2027-01-01','2027-01-18'])
FUTURE_DATES = pd.bdate_range(AS_OF + pd.Timedelta(days=1), TARGET).difference(HOLIDAYS)
HORIZON = len(FUTURE_DATES)
LOOKBACK = 1260
WARMUP = 504  # Include 2008 rather than starting evaluation only after the GFC.
TREND_SHRINKAGE = .25  # Fixed before evaluation; no fitted news score or parameter search.
SEED = 20261106


def read(name):
    return pd.read_csv(ROOT / (name+'.csv'), parse_dates=['date']).set_index('date')['close'].rename(name)


prices = pd.concat([read(s) for s in ALL_PRICE], axis=1).dropna()
returns = np.log(prices).diff().dropna()
vix = read('VIX').reindex(prices.index, method='ffill')


def state(history, vix_value, use_vix=True):
    """Past-only factor volatility floor and strongly shrunk historical drift."""
    mu = history.tail(252).mean().to_numpy() * TREND_SHRINKAGE
    real = np.vstack([history.tail(n).std(ddof=1).to_numpy() for n in (21,63,252)]).max(axis=0)
    market_col = history.columns.get_loc('GSPC')
    market_risk = max(real[market_col], vix_value/100/np.sqrt(252)) if use_vix else real[market_col]
    market = history['GSPC'].tail(252).to_numpy()
    beta, sigma = [], []
    for k, name in enumerate(history.columns):
        if name == 'GSPC':
            beta.append(1.)
            sigma.append(market_risk)
            continue
        sample = history[name].tail(252).to_numpy()
        b = np.cov(sample, market, ddof=1)[0,1] / np.var(market, ddof=1)
        residual = sample - b*market
        idio = max(np.std(residual[-n:], ddof=1) for n in (21,63,252))
        sigma.append(max(real[k], np.sqrt(b*b*market_risk**2+idio**2)))
        beta.append(b)
    return mu, np.array(sigma), np.array(beta), real


def simulate(history, vix_value, samples, seed, block=5, vol_scale=1., use_vix=True):
    """Paired circular 5-day blocks: centered raw returns, current volatility fixed.

    This preserves sample cross-asset dependence within resampled blocks, but is not
    a GARCH model and does not forecast future volatility regimes or news arrival.
    """
    mu, sigma, beta, real = state(history, vix_value, use_vix)
    pool = history.tail(LOOKBACK).to_numpy()
    z = (pool-pool.mean(axis=0))/pool.std(axis=0,ddof=1)
    rng = np.random.default_rng(seed)
    starts = rng.integers(0,len(z),size=(samples, math.ceil(HORIZON/block)))
    indices = (starts[:,:,None]+np.arange(block))%len(z)
    indices = indices.reshape(samples,-1)[:,:HORIZON]
    shocks = z[indices]*sigma*vol_scale
    log_paths = np.cumsum(shocks+mu,axis=1)
    return log_paths, (mu,sigma,beta,real)


def backtest():
    # Last origin first, then every HORIZON sessions backwards: no overlapping
    # target intervals, and the latest included forecast ends at AS_OF.
    last_origin = len(returns)-HORIZON-1
    origins = sorted(range(last_origin, WARMUP-1, -HORIZON))
    rows=[]
    for number, origin in enumerate(origins):
        hist=returns.iloc[:origin+1]
        date=hist.index[-1]
        logs,_=simulate(hist,float(vix.loc[date]),samples=2000,seed=SEED+number)
        end=logs[:,-1,:]
        low,high=np.quantile(end,[.1,.9],axis=0)
        mu=hist.tail(252).mean().to_numpy()*TREND_SHRINKAGE*HORIZON
        actual=returns.iloc[origin+1:origin+1+HORIZON].sum().to_numpy()
        for k,name in enumerate(returns.columns):
            rows.append({'asset':name,'origin':str(date.date()),
                         'end':str(returns.index[origin+HORIZON].date()),
                         'actual_return':np.expm1(actual[k]),
                         'trend_point':np.expm1(mu[k]),'flat_point':0.,
                         'p10_return':np.expm1(low[k]),'p90_return':np.expm1(high[k]),
                         'covered_80':bool(low[k]<=actual[k]<=high[k]),
                         'trend_sign_correct':bool(np.sign(mu[k])==np.sign(actual[k]))})
    frame=pd.DataFrame(rows)
    frame.to_csv(OUT/'backtest_windows.csv',index=False)
    summary=[]
    for name,g in frame.groupby('asset',sort=False):
        ea=g.actual_return-g.trend_point
        ef=g.actual_return
        summary.append({'asset':name,'windows':len(g),'first_origin':g.origin.iloc[0],
                        'last_end':g.end.iloc[-1],
                        'trend_MAE':ea.abs().mean(),'flat_MAE':ef.abs().mean(),
                        'trend_RMSE':np.sqrt((ea**2).mean()),'flat_RMSE':np.sqrt((ef**2).mean()),
                        'interval_coverage':g.covered_80.mean(),
                        'trend_direction_accuracy':g.trend_sign_correct.mean(),
                        'always_up_accuracy':(g.actual_return>0).mean()})
    summary=pd.DataFrame(summary)
    summary.to_csv(OUT/'backtest_summary.csv',index=False)
    return summary


def scenario_table():
    # SUBJECTIVE forward-earnings/valuation changes over THIS forecast horizon.
    # These are explicit assumptions, not probabilities or historical fit.
    settings={
        'GSPC':{'bear':(-.04,-.12),'base':(.02,0.),'bull':(.04,.06)},
        'NDX':{'bear':(-.07,-.18),'base':(.03,-.02),'bull':(.06,.10)},
        'KO':{'bear':(0.,-.10),'base':(.02,0.),'bull':(.03,.05)},
        'GOOGL':{'bear':(-.08,-.20),'base':(.03,-.04),'bull':(.07,.12)},
    }
    rows=[]
    for name,scenarios in settings.items():
        for case,(earnings,multiple) in scenarios.items():
            ret=(1+earnings)*(1+multiple)-1
            rows.append({'asset':name,'scenario':case,
                         'forward_earnings_estimate_change_assumption':earnings,
                         'valuation_multiple_change_assumption':multiple,
                         'price_return':ret,'terminal_price':prices[name].iloc[-1]*(1+ret)})
    frame=pd.DataFrame(rows)
    frame.to_csv(OUT/'news_scenarios.csv',index=False)
    return frame


def main():
    hist=returns[ASSETS]
    # Keep ordering explicit for factor indexing and shared resampling.
    logs,state_now=simulate(hist,float(vix.iloc[-1]),samples=20000,seed=SEED)
    mu,sigma,beta,real=state_now
    rows=[]
    bands=[]
    market=[]
    for k,name in enumerate(ASSETS):
        current=prices[name].iloc[-1]
        end=logs[:,-1,k]
        q=np.quantile(end,[.05,.10,.25,.50,.75,.90,.95])
        rows.append({'asset':name,'current_price':current,'horizon_sessions':HORIZON,
                     'trend_point_return':np.expm1(mu[k]*HORIZON),
                     'sigma_annual':sigma[k]*np.sqrt(252),
                     'realized_vol_floor_annual':real[k]*np.sqrt(252),
                     'beta_252_to_SP500':beta[k],
                     'simulated_up_fraction':float((end>0).mean()),
                     'simulated_loss_over_10pct_fraction':float((end<np.log(.9)).mean()),
                     **{f'p{n}_return':np.expm1(q[j]) for j,n in enumerate([5,10,25,50,75,90,95])},
                     **{f'p{n}_price':current*np.exp(q[j]) for j,n in enumerate([5,10,25,50,75,90,95])}})
        qs=np.quantile(logs[:,:,k],[.10,.25,.5,.75,.90],axis=0)
        for j,date in enumerate(FUTURE_DATES):
            bands.append({'date':str(date.date()),'asset':name,
                          **{f'p{n}':current*np.exp(qs[l,j]) for l,n in enumerate([10,25,50,75,90])}})
    forecast=pd.DataFrame(rows)
    forecast.to_csv(OUT/'forecast.csv',index=False)
    bands=pd.DataFrame(bands)
    bands.to_csv(OUT/'forecast_paths_quantiles.csv',index=False)
    for name in ALL_PRICE:
        p=prices[name]
        peak=p.tail(252).max()
        market.append({'asset':name,'close':p.iloc[-1],
                       'return_1d':p.iloc[-1]/p.iloc[-2]-1,
                       'return_21d':p.iloc[-1]/p.iloc[-22]-1,
                       'return_63d':p.iloc[-1]/p.iloc[-64]-1,
                       'vs_50day_SMA':p.iloc[-1]/p.tail(50).mean()-1,
                       'vs_200day_SMA':p.iloc[-1]/p.tail(200).mean()-1,
                       'SMA50':p.tail(50).mean(),'SMA200':p.tail(200).mean(),
                       'drawdown_from_252d_close_high':p.iloc[-1]/peak-1,
                       'high_252d_close':peak,
                       'min_21d_close':p.tail(21).min(),'max_21d_close':p.tail(21).max()})
    pd.DataFrame(market).to_csv(OUT/'market_snapshot.csv',index=False)
    hist.tail(252).corr().to_csv(OUT/'correlations_252d.csv')
    bt=backtest()
    cases=scenario_table()

    sensitivity=[]
    for tag,block,scale,use_vix in [('block_1',1,1.,True),('block_10',10,1.,True),
                                  ('vol_1_5x',5,1.5,True),('realized_only',5,1.,False)]:
        alt,_=simulate(hist,float(vix.iloc[-1]),samples=10000,seed=SEED+block,
                       block=block,vol_scale=scale,use_vix=use_vix)
        for k,name in enumerate(ASSETS):
            q=np.expm1(np.quantile(alt[:,-1,k],[.1,.5,.9]))
            sensitivity.append({'asset':name,'case':tag,'p10':q[0],'p50':q[1],'p90':q[2]})
    pd.DataFrame(sensitivity).to_csv(OUT/'sensitivity.csv',index=False)

    # Independent arithmetic checks, plus absence of future data.
    assert HORIZON==62 and prices.index[-1]==AS_OF
    assert returns.index[-1]<=AS_OF
    assert np.isclose(1.03*.96-1,-.0112)
    for k,name in enumerate(ASSETS):
        row=forecast[forecast.asset==name].iloc[0]
        assert row.p10_price < row.p50_price < row.p90_price
        assert np.isclose(row.p50_price/row.current_price-1,row.p50_return)
    assert (bt.windows>50).all()
    (ROOT/'model_config.json').write_text(json.dumps({
        'as_of':str(AS_OF.date()),'target':str(TARGET.date()),'sessions':HORIZON,
        'assets':ASSETS,'seed':SEED,'samples':20000,'block_sessions':5,
        'bootstrap_history_sessions':LOOKBACK,'backtest_min_history_sessions':WARMUP,
        'trend_shrinkage':TREND_SHRINKAGE,
        'backtest':'Non-overlapping 62-session targets; origins spaced backwards from latest fully observed target. All parameters use past data only; no news backtest.',
        'risk_model':'max(realized 21/63/252-session vols, market-factor VIX floor plus idiosyncratic realized vol). VIX is 30-day implied SP500 vol and is held constant over horizon as a regime assumption, not a three-month options forecast.',
        'scope':'Price-only USD nominal returns; no dividends, personal taxes, fees or FX. Daily quantiles are marginal, not a simultaneous path envelope. News scenarios are subjective, unweighted.',
    },ensure_ascii=False,indent=2))

    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,
                         'axes.spines.right':False,'figure.facecolor':'white'})
    fig,axes=plt.subplots(2,2,figsize=(13,8.3),constrained_layout=True)
    for ax,name in zip(axes.flat,ASSETS):
        p=prices[name].tail(126)
        b=bands[bands.asset==name]
        dates=pd.to_datetime(b.date)
        ax.plot(p.index,p,color='#283d50',lw=1.6,label='Observed close')
        ax.fill_between(dates,b.p10.to_numpy(),b.p90.to_numpy(),color='#3479b8',alpha=.16,label='Conditional P10-P90')
        ax.fill_between(dates,b.p25.to_numpy(),b.p75.to_numpy(),color='#3479b8',alpha=.25,label='Conditional P25-P75')
        ax.plot(dates,b.p50,color='#3479b8',lw=1.4,label='Simulation median')
        ax.axvline(AS_OF,color='#999',ls=':',lw=1)
        for scenario,color in [('bear','#b74742'),('base','#d49124'),('bull','#428658')]:
            value=cases[(cases.asset==name)&(cases.scenario==scenario)].terminal_price.iloc[0]
            ax.scatter([TARGET],[value],s=25,color=color,zorder=4)
        ax.set_title(f'{LABELS[name]} | {prices[name].iloc[-1]:,.2f}')
        ax.grid(alpha=.15)
        ax.tick_params(axis='x',rotation=25)
    axes[0,0].legend(frameon=False,fontsize=8,loc='upper left')
    fig.suptitle('Three-month conditional risk model | 2026-11-05 close to 2027-02-05',fontsize=15)
    fig.supxlabel('Terminal dots: subjective bear / base / bull scenarios. Bands are not guaranteed paths.')
    fig.savefig(ROOT/'forecast.png',dpi=180)
    fig.savefig(ROOT/'forecast.pdf')
    plt.close(fig)
    print('SNAPSHOT\n'+pd.DataFrame(market).to_string(index=False))
    print('\nFORECAST\n'+forecast[['asset','sigma_annual','beta_252_to_SP500','trend_point_return','p10_return','p50_return','p90_return','p10_price','p50_price','p90_price','simulated_up_fraction']].to_string(index=False))
    print('\nBACKTEST\n'+bt.to_string(index=False))
    print('\nSCENARIOS\n'+cases.to_string(index=False))
    print('\nChecks passed.')


if __name__=='__main__':
    main()
