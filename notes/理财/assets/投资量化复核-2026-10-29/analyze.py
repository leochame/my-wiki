"""Reproduce the investment review from frozen local data; no trading calls.

Requires Python 3.10+, numpy, pandas, matplotlib. Run from any directory.
All returns are nominal, gross of personal taxes and transaction/FX costs.
"""
from pathlib import Path
import json
import math

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
WEIGHTS = {
    "SP500": np.array([1.0, 0.0, 0.0]),
    "80_10_10": np.array([0.8, 0.1, 0.1]),
    "90_10_0": np.array([0.9, 0.1, 0.0]),
    "90_0_10": np.array([0.9, 0.0, 0.1]),
    "60_20_20": np.array([0.6, 0.2, 0.2]),
    "NASDAQ100": np.array([0.0, 1.0, 0.0]),
    "BRKB": np.array([0.0, 0.0, 1.0]),
}


def load(symbol):
    frame = pd.read_csv(ROOT / f"{symbol}.csv", parse_dates=["date"]).set_index("date")
    return frame["adjclose"].rename(symbol)


def portfolio(prices, weights, mode="semiannual"):
    """Start at a close, then let holdings drift; rebalance AFTER selected closes."""
    relative = prices.pct_change(fill_method=None).iloc[1:].to_numpy() + 1
    dates = prices.index
    values = weights.astype(float).copy()
    nav = [1.0]
    for k, growth in enumerate(relative, start=1):
        values *= growth
        nav.append(values.sum())
        month_end = k == len(dates) - 1 or dates[k + 1].month != dates[k].month
        rebalance = mode == "monthly" and month_end
        rebalance |= mode == "semiannual" and month_end and dates[k].month in (6, 12)
        if rebalance:
            values = values.sum() * weights
    return pd.Series(nav, index=dates)


def metrics(nav):
    returns = nav.pct_change(fill_method=None).dropna()
    years = (nav.index[-1] - nav.index[0]).days / 365.25
    drawdown = nav / nav.cummax() - 1
    trough = drawdown.idxmin()
    peak = nav.loc[:trough].idxmax()
    return {
        "first_date": str(nav.index[0].date()), "last_date": str(nav.index[-1].date()),
        "CAGR": (nav.iloc[-1] / nav.iloc[0]) ** (1 / years) - 1,
        "annual_vol": returns.std(ddof=1) * np.sqrt(252),
        "max_drawdown": drawdown.min(), "peak_date": str(peak.date()),
        "trough_date": str(trough.date()), "wealth_multiple": nav.iloc[-1] / nav.iloc[0],
    }


def monthly(nav):
    # Exclude incomplete October 2026 from all monthly windows and bootstrap draws.
    out = nav.resample("ME").last()
    return out.loc[:"2026-09-30"]


def risk_table(prices):
    returns = prices.pct_change(fill_method=None).dropna()
    covariance = returns.cov().to_numpy() * 252
    weights = WEIGHTS["80_10_10"]
    variance = weights @ covariance @ weights
    shares = weights * (covariance @ weights) / variance
    risk = pd.DataFrame({"capital_weight": weights, "variance_share": shares,
                         "standalone_vol": np.sqrt(np.diag(covariance))}, index=prices.columns)
    assert np.isclose(shares.sum(), 1)
    return returns.corr(), risk


def bootstrap(nav, base, block, seed=20261029, samples=6000):
    """Paired circular moving-block resampling of realized monthly log NAV returns.

    This diagnoses uncertainty in historical CAGR differences, not future alpha.
    Rebalancing is already embedded in NAV; simulated paths do not rerun trades.
    """
    logs = np.log(pd.concat([monthly(nav), monthly(base)], axis=1)).diff().dropna().to_numpy()
    count = len(logs)
    rng = np.random.default_rng(seed + block)
    starts = rng.integers(0, count, size=(samples, math.ceil(count / block)))
    indices = (starts[:, :, None] + np.arange(block)) % count
    indices = indices.reshape(samples, -1)[:, :count]
    annual_log = logs[indices].mean(axis=1) * 12
    differences = np.exp(annual_log[:, 0]) - np.exp(annual_log[:, 1])
    realized = np.exp(logs.mean(axis=0) * 12)
    return {"block_months": block, "samples": samples,
            "CAGR_difference": realized[0] - realized[1],
            "percentile_2_5": float(np.quantile(differences, .025)),
            "percentile_97_5": float(np.quantile(differences, .975))}


def xirr_equal_months(final_value, contribution=20000):
    """Annual effective IRR: 30 payments at months 2,4,...,60, terminal at 60."""
    remaining_years = (60 - np.arange(2, 61, 2)) / 12
    def terminal(rate):
        return float(np.sum(contribution * (1 + rate) ** remaining_years))
    low, high = -0.999, 5.0
    for _ in range(90):
        mid = (low + high) / 2
        if terminal(mid) > final_value:
            high = mid
        else:
            low = mid
    return (low + high) / 2


def rolling_dca(prices, fx, weights, contribution=20000):
    """All overlapping 60-month windows; buy at month-end every second month.

    Contributions buy target-weight asset amounts. At Jun/Dec closes, rebalance
    the full account to target (a more mechanical rule than the user's threshold).
    """
    stock = prices.loc[:"2026-09-30"].resample("ME").last()
    fxm = fx.reindex(prices.index, method="ffill").resample("ME").last()
    joint = stock.join(fxm.rename("fx")).dropna()
    monthly_growth = joint.iloc[:, :3].pct_change(fill_method=None)
    result = []
    for start in range(len(joint) - 60):
        values = np.zeros(3)
        for month in range(1, 61):
            row = start + month
            values *= 1 + monthly_growth.iloc[row].to_numpy()
            if month % 2 == 0:
                values += contribution / joint.fx.iloc[row] * weights
            if joint.index[row].month in (6, 12):
                values = values.sum() * weights
        end_value = values.sum() * joint.fx.iloc[start + 60]
        result.append({"start": str(joint.index[start].date()),
                       "end": str(joint.index[start + 60].date()),
                       "terminal_CNY": end_value,
                       "profit_CNY": end_value - 30 * contribution,
                       "annual_money_weighted_return": xirr_equal_months(end_value)})
    return pd.DataFrame(result)


def scenario_dca(annual_return, terminal_fx, pattern="linear", opening_fx=6.67):
    balance = 0.0
    for k in range(1, 31):
        t = k / 30
        progress = t if pattern == "linear" else (min(1., t * 5) if pattern == "early" else max(0., (t - .8) * 5))
        fx = opening_fx + (terminal_fx - opening_fx) * progress
        balance *= (1 + annual_return) ** (1 / 6)
        balance += 20000 / fx
    return balance * terminal_fx


def main():
    long_prices = pd.concat([load(s) for s in ["SPY", "QQQ", "BRK-B"]], axis=1).dropna()
    actual_prices = pd.concat([load(s) for s in ["VOO", "QQQM", "BRK-B"]], axis=1).dropna()
    rows, paths = [], {}
    samples = {"long_proxy": long_prices, "actual_since_2020": actual_prices,
               "2000_2009_proxy": long_prices.loc["1999-12-31":"2009-12-31"],
               "2010_2019_proxy": long_prices.loc["2009-12-31":"2019-12-31"],
               "2020_2026_proxy": long_prices.loc["2019-12-31":]}
    for period, prices in samples.items():
        for name, weights in WEIGHTS.items():
            nav = portfolio(prices, weights)
            rows.append({"period": period, "portfolio": name, **metrics(nav)})
            if period in ("long_proxy", "actual_since_2020"):
                paths[(period, name)] = nav
    summary = pd.DataFrame(rows)
    summary.to_csv(OUT / "historical_metrics.csv", index=False)
    pd.DataFrame({name: paths[("long_proxy", name)] for name in WEIGHTS}).to_csv(OUT / "daily_NAV_proxy.csv")
    for period, prices in [("long", long_prices), ("recent", actual_prices)]:
        correlation, risk = risk_table(prices)
        correlation.to_csv(OUT / f"correlation_{period}.csv")
        risk.to_csv(OUT / f"risk_contributions_{period}.csv")

    boot = []
    for period in ("long_proxy", "actual_since_2020"):
        for block in (6, 12, 24):
            boot.append({"period": period, **bootstrap(paths[(period, "80_10_10")], paths[(period, "SP500")], block)})
    pd.DataFrame(boot).to_csv(OUT / "paired_block_bootstrap.csv", index=False)

    # Show sensitivity to rebalancing assumptions without optimizing on the sample.
    rebalance_rows = []
    for mode in ("none", "semiannual", "monthly"):
        rebalance_rows.append({"mode": mode, **metrics(portfolio(long_prices, WEIGHTS["80_10_10"], mode))})
    pd.DataFrame(rebalance_rows).to_csv(OUT / "rebalance_sensitivity.csv", index=False)

    rolling_rows = []
    for name in ("SP500", "80_10_10", "60_20_20", "NASDAQ100"):
        navm = monthly(paths[("long_proxy", name)])
        r5 = (navm / navm.shift(60)) ** (1 / 5) - 1
        for date, value in r5.dropna().items():
            rolling_rows.append({"portfolio": name, "end": str(date.date()), "five_year_CAGR": value})
    rolling = pd.DataFrame(rolling_rows)
    rolling.to_csv(OUT / "rolling_5y_USD.csv", index=False)

    fx = pd.read_csv(ROOT / "FED_USDCNY.csv", parse_dates=["date"]).set_index("date").CNY_per_USD
    # Use only dates covered by the primary FX source. No extension to Oct 28.
    cny_prices = long_prices.loc[fx.index[0]:fx.index[-1]]
    dca_all, dca_summary = [], []
    for name in ("SP500", "80_10_10", "60_20_20"):
        dca = rolling_dca(cny_prices, fx, WEIGHTS[name])
        dca.insert(0, "portfolio", name)
        dca_all.append(dca)
        worst = dca.loc[dca.terminal_CNY.idxmin()]
        dca_summary.append({"portfolio": name, "windows": len(dca),
            "loss_windows": int((dca.terminal_CNY < 600000).sum()),
            "historical_loss_fraction": float((dca.terminal_CNY < 600000).mean()),
            "worst_terminal_CNY": worst.terminal_CNY, "worst_start": worst.start,
            "worst_end": worst.end,
            "median_terminal_CNY": float(dca.terminal_CNY.median()),
            "best_terminal_CNY": float(dca.terminal_CNY.max())})
    dca_all = pd.concat(dca_all, ignore_index=True)
    dca_all.to_csv(OUT / "rolling_5y_DCA_CNY.csv", index=False)
    pd.DataFrame(dca_summary).to_csv(OUT / "DCA_summary.csv", index=False)

    scenarios = []
    for r in (-.10, 0, .05, .08, .12):
        for endfx in (5.5, 6.0, 6.67, 7.3):
            value = scenario_dca(r, endfx)
            scenarios.append({"USD_annual_return": r, "terminal_USDCNY": endfx,
                              "terminal_CNY": value, "profit_CNY": value - 600000,
                              "CNY_money_weighted_return": xirr_equal_months(value)})
    scenarios = pd.DataFrame(scenarios)
    scenarios.to_csv(OUT / "forward_DCA_scenarios.csv", index=False)
    pd.DataFrame([{"pattern": p, "terminal_CNY": scenario_dca(.05, 6., p)}
                  for p in ("early", "linear", "late")]).to_csv(OUT / "FX_path_sensitivity.csv", index=False)

    # An end-of-year-5 stock crash, AFTER contributions; nominal USD total return.
    smooth = scenario_dca(.05, 6.67)
    # Round the observed ~54% stock drawdown to 55%, then combine with FX stress.
    stock_crash, fx_shock = -.55, 6.0 / 6.67 - 1
    budget = []
    for equity in (1., .9, .8, .7):
        combined_shock = equity * ((1 + stock_crash) * (1 + fx_shock) - 1)
        # Remainder held as CNY cash at assumed 0% for transparent stress arithmetic.
        end_value = equity * smooth * (1 + stock_crash) * (1 + fx_shock) + (1 - equity) * 600000
        budget.append({"equity_fraction": equity, "portfolio_instantaneous_shock": combined_shock,
                       "DCA_terminal_after_crash_CNY": end_value})
    pd.DataFrame(budget).to_csv(OUT / "stress_budget.csv", index=False)

    valuation = []
    for growth in (.04, .08, .12):
        for terminal_pe in (16., 20.44, 24.):
            price_cagr = (1 + growth) * (terminal_pe / 20.44) ** .2 - 1
            valuation.append({"EPS_annual_growth_assumption": growth, "terminal_forward_PE": terminal_pe,
                              "five_year_price_CAGR": price_cagr,
                              "rough_total_CAGR_plus_1_10pct_yield": price_cagr + .011})
    pd.DataFrame(valuation).to_csv(OUT / "valuation_sensitivity.csv", index=False)

    # Independently check portfolio arithmetic and contribution timing.
    for i, column in enumerate(long_prices.columns):
        weights = np.eye(3)[i]
        actual = portfolio(long_prices, weights)
        expected = long_prices[column] / long_prices[column].iloc[0]
        assert np.allclose(actual, expected, rtol=1e-10)
    assert np.isclose(scenario_dca(0, 6.67), 600000)
    direct = 20000 * np.sum(1.05 ** (np.arange(29, -1, -1) / 6))
    assert np.isclose(scenario_dca(.05, 6.67), direct)
    assert np.isclose(xirr_equal_months(direct), .05)
    assert all(v.sum() == 1 for v in WEIGHTS.values())
    # Cross-check DCA against an independent unit-NAV formula for a single asset.
    one = dca_all[dca_all.portfolio == "SP500"].iloc[0]
    stock_m = cny_prices.resample("ME").last().loc[:"2026-09-30"]
    fx_m = fx.reindex(cny_prices.index, method="ffill").resample("ME").last().loc[:"2026-09-30"]
    joined = stock_m.join(fx_m.rename("fx")).dropna()
    contribution_rows = np.arange(2, 61, 2)
    units = np.sum(20000 / (joined.fx.iloc[contribution_rows] * joined.SPY.iloc[contribution_rows]))
    direct_end = units * joined.SPY.iloc[60] * joined.fx.iloc[60]
    assert np.isclose(one.terminal_CNY, direct_end)

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "figure.facecolor": "white"})
    colors = {"SP500": "#2962a8", "80_10_10": "#dd7832", "60_20_20": "#468c68", "NASDAQ100": "#8e6ba8"}
    labels = {"SP500": "100% S&P 500", "80_10_10": "80/10/10 (current)",
              "60_20_20": "60/20/20", "NASDAQ100": "100% Nasdaq-100"}
    fig, axes = plt.subplots(2, 2, figsize=(13, 8.6), constrained_layout=True)
    for name in ("SP500", "80_10_10", "60_20_20", "NASDAQ100"):
        nav = paths[("long_proxy", name)]
        axes[0, 0].plot(nav.index, nav, color=colors[name], label=labels[name], linewidth=1.4)
        axes[0, 1].plot(nav.index, nav / nav.cummax() - 1, color=colors[name], linewidth=1.1)
        r = rolling[rolling.portfolio == name]
        axes[1, 0].plot(pd.to_datetime(r.end), r.five_year_CAGR, color=colors[name], linewidth=1.25)
    axes[0, 0].set_yscale("log")
    axes[0, 0].set_title("USD growth of $1 | log scale")
    axes[0, 0].legend(frameon=False, fontsize=8, loc="upper left")
    axes[0, 1].set_title("Drawdown from prior USD peak")
    axes[0, 1].yaxis.set_major_formatter(PercentFormatter(1))
    axes[1, 0].set_title("Rolling 5-year USD annualized return")
    axes[1, 0].yaxis.set_major_formatter(PercentFormatter(1))
    axes[1, 0].axhline(0, color="#777", linewidth=.8)
    for name in ("SP500", "80_10_10", "60_20_20"):
        d = dca_all[dca_all.portfolio == name]
        axes[1, 1].plot(pd.to_datetime(d.end), d.terminal_CNY / 10000, color=colors[name], label=labels[name], linewidth=1.3)
    axes[1, 1].axhline(60, color="#b53d42", linestyle="--", label="Contributions: CNY 600,000")
    axes[1, 1].set_title("5-year DCA in CNY | 20,000 every 2 months")
    axes[1, 1].set_ylabel("CNY 10,000")
    axes[1, 1].legend(frameon=False, fontsize=8)
    for ax in axes.flat:
        ax.grid(alpha=.15)
        ax.set_xlabel("Window end" if ax in axes[1, :] else "Date")
    fig.suptitle("Review of the existing allocation | frozen data through 2026-10-28", fontsize=15)
    fig.savefig(ROOT / "investment_review.png", dpi=180)
    fig.savefig(ROOT / "investment_review.pdf")
    plt.close(fig)

    print("HISTORICAL METRICS")
    print(summary[summary.period.isin(["long_proxy", "actual_since_2020"])].to_string(index=False))
    print("\nDCA SUMMARY")
    print(pd.DataFrame(dca_summary).to_string(index=False))
    print("\nBOOTSTRAP")
    print(pd.DataFrame(boot).to_string(index=False))
    print("\nAll arithmetic checks passed.")


if __name__ == "__main__":
    main()
