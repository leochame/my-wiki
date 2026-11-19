"""Review discount-rate sensitivity without modifying earlier valuation inputs."""
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parent


def evaluate(revenue, margins, rate, growth, cash, shares):
    flows = [r * m for r, m in zip(revenue, margins)]
    explicit = sum(f / (1 + rate) ** (i + 1) for i, f in enumerate(flows))
    terminal = flows[-1] * (1 + growth) / (rate - growth) / (1 + rate) ** len(flows)
    equity = explicit + terminal + cash
    return {"discount_rate": rate, "post_ipo_equity_usd_bn": equity,
            "price_at_constant_capitalization": equity / shares,
            "terminal_fraction_of_enterprise_value": terminal / (explicit + terminal)}


def main():
    config = json.loads((ROOT / "inputs.json").read_text())
    old_output = json.loads((ROOT / "results.json").read_text())
    base = config["base"]
    shares = sum(config["diluted_share_components_billion_at_74"].values())
    uplift = config["roadshow_sensitivity"]["revenue_2028"] / base["revenue"][1]
    stronger = [config["roadshow_sensitivity"]["revenue_2027"]]
    stronger.extend(r * uplift for r in base["revenue"][1:])
    scenarios = {}
    for name, revenue in [("original_growth", base["revenue"]),
                          ("persistent_roadshow_growth", stronger)]:
        scenarios[name] = [evaluate(revenue, base["fcff_margin"], rate,
                                   base["terminal_growth"], config["post_ipo_cash_bridge"], shares)
                           for rate in [0.14, 0.13, 0.12, 0.11]]
    original_13 = scenarios["original_growth"][1]["post_ipo_equity_usd_bn"]
    stronger_13 = scenarios["persistent_roadshow_growth"][1]["post_ipo_equity_usd_bn"]
    assert math.isclose(original_13, old_output["original_base"]["post_ipo_equity_value"])
    assert math.isclose(stronger_13, old_output["persistent_roadshow_growth_sensitivity"]["post_ipo_equity_value"])
    output = {
        "as_of": "2026-11-14, Asia/Shanghai",
        "purpose": "Audit prior conservatism and precision, not raise estimates to match market prices.",
        "sensitivity": scenarios,
        "stronger_revenue_path": stronger,
        "constant_diluted_economic_shares_billion": shares,
        "warnings": [
            "Discount rates are subjective required returns, not observed market-implied parameters.",
            "Persistence of bank-reported 2028 growth beyond 2028 is an analyst assumption.",
            "Price equivalents freeze 74-dollar offering capitalization and 200bn cash bridge.",
            "No result is a calibrated forecast, fair-value ceiling, or support/resistance level."
        ],
        "google_reference": {
            "regular_session_date_us_eastern": "2026-11-13",
            "googl_close": 295.77,
            "goog_close": 292.52,
            "googl_after_hours_19_59_et": 294.05,
            "goog_after_hours_19_59_et": 290.78,
            "prior_298_70_date_us_eastern": "2026-11-12",
            "price_source": "S&P Global Market Intelligence price history published by Stock Analysis; GOOGL regular close cross-checked with Yahoo history.",
            "googl_premium_to_goog": 295.77 / 292.52 - 1,
            "return_since_2026_11_05": 295.77 / 282.57 - 1,
            "previous_buy_rule_returns_from_latest_close": {str(p): p / 295.77 - 1 for p in [245, 250, 255, 260, 265, 270, 275, 280, 285]},
            "previous_exit_rule_returns_from_latest_close": {str(p): p / 295.77 - 1 for p in [330, 350, 375, 390]},
            "independent_google_dcf_completed_here": False
        },
        "input_sha256": hashlib.sha256((ROOT / "inputs.json").read_bytes()).hexdigest(),
        "sources": [
            "https://stockanalysis.com/stocks/googl/history/",
            "https://stockanalysis.com/stocks/goog/history/",
            "https://s206.q4cdn.com/479360582/files/doc_news/2026/Oct/28/attachments/2026q3-alphabet-earnings-release.pdf",
            "https://www.aol.com/articles/exclusive-investors-flock-anthropic-ipo-220347000.html",
            "https://kraneshares.com/weekly-private-markets-wrap-anthropic-sets-an-ipo-price-range-as-ai-valuations-diverge/"
        ]
    }
    (ROOT / "review_sensitivity.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(scenarios["persistent_roadshow_growth"], indent=2))


if __name__ == "__main__":
    main()
