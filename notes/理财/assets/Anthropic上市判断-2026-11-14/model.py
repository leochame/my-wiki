"""IPO valuation comparisons; subjective scenarios, never a price forecast.

All money is USD billion. Produces JSON only. No network or account access.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent


def value(revenue, margins, rate, growth, cash_bridge):
    flows = [sales * margin for sales, margin in zip(revenue, margins)]
    explicit = sum(flow / (1 + rate) ** (i + 1) for i, flow in enumerate(flows))
    terminal = flows[-1] * (1 + growth) / (rate - growth) / (1 + rate) ** len(flows)
    return {
        "revenue_path": revenue,
        "enterprise_value": explicit + terminal,
        "post_ipo_equity_value": explicit + terminal + cash_bridge,
        "terminal_fraction_of_enterprise_value": terminal / (explicit + terminal),
    }


def main():
    assumptions = json.loads((ROOT / "inputs.json").read_text())
    base = assumptions["base"]
    shares = sum(assumptions["diluted_share_components_billion_at_74"].values())
    rate = base["discount_rate"]
    growth = base["terminal_growth"]
    cash = assumptions["post_ipo_cash_bridge"]
    old = value(base["revenue"], base["fcff_margin"], rate, growth, cash)
    factor = assumptions["roadshow_sensitivity"]["revenue_2028"] / base["revenue"][1]
    stronger = [assumptions["roadshow_sensitivity"]["revenue_2027"]]
    stronger.extend(revenue * factor for revenue in base["revenue"][1:])
    roadshow = value(stronger, base["fcff_margin"], rate, growth, cash)
    for scenario in (old, roadshow):
        scenario["equivalent_price_at_constant_capitalization"] = scenario["post_ipo_equity_value"] / shares
    prices = [40, 45, 50, 55, 60, 65, 70, 74, 78, 80, 85, 90, 100, 110]
    output = {
        "as_of": assumptions["as_of"],
        "money_unit": "USD billion",
        "diluted_economic_shares_billion": shares,
        "capitalization_warning": assumptions["capitalization_warning"],
        "original_base": old,
        "persistent_roadshow_growth_sensitivity": roadshow,
        "price_equity_comparisons": [
            {"price": price, "diluted_equity_value": price * shares,
             "premium_to_original_base": price * shares / old["post_ipo_equity_value"] - 1,
             "premium_to_roadshow_sensitivity": price * shares / roadshow["post_ipo_equity_value"] - 1}
            for price in prices
        ],
        "ipo_cost_74_exit_examples_before_fees_and_tax": [
            {"exit": price, "return_pct": (price / 74 - 1) * 100}
            for price in [66.6, 80, 85, 90, 100]
        ],
        "judgment_not_calibrated_probabilities": True,
        "input_sha256": hashlib.sha256((ROOT / "inputs.json").read_bytes()).hexdigest(),
    }
    (ROOT / "results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "shares_billion": shares,
        "original_base_equity": old["post_ipo_equity_value"],
        "original_base_price": old["equivalent_price_at_constant_capitalization"],
        "roadshow_equity": roadshow["post_ipo_equity_value"],
        "roadshow_price": roadshow["equivalent_price_at_constant_capitalization"],
    }, indent=2))


if __name__ == "__main__":
    main()
