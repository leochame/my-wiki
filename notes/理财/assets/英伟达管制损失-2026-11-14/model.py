"""Reproduce the 2026-11-14 NVIDIA China-policy judgment scenarios.

Python standard library only. All money is USD billion. The scenario inputs are
subjective and are explicitly distinguished from reported company facts.
"""

import json
from decimal import Decimal
from pathlib import Path


BASE = Path(__file__).resolve().parent
D = Decimal


def write_json(name, data):
    (BASE / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )


def main():
    assumptions = json.loads((BASE / "assumptions.json").read_text(encoding="utf-8"))
    facts = assumptions["reported_facts"]
    annualized = D(facts["global_revenue"]) * 4
    channels, totals = [], []
    for scenario in assumptions["scenarios"]:
        exposed = blocked = replacement = net = D("0")
        for channel in scenario["channels"]:
            revenue = D(channel["exposure"])
            prevented = revenue * D(channel["blocked_fraction"])
            offset = prevented * D(channel["replacement_fraction"])
            lost = prevented - offset
            exposed += revenue
            blocked += prevented
            replacement += offset
            net += lost
            channels.append({
                "scenario": scenario["id"],
                "category": channel["category"],
                "exposure_usd_bn": revenue,
                "blocked_fraction": channel["blocked_fraction"],
                "replacement_fraction": channel["replacement_fraction"],
                "blocked_sales_usd_bn": prevented,
                "replacement_sales_usd_bn": offset,
                "net_loss_usd_bn": lost,
                "net_loss_usd_100m": lost * 10,
            })
        totals.append({
            "scenario": scenario["id"],
            "label": scenario["label"],
            "exposure_usd_bn": exposed,
            "blocked_sales_usd_bn": blocked,
            "replacement_sales_usd_bn": replacement,
            "net_loss_usd_bn": net,
            "net_loss_usd_100m": net * 10,
            "loss_pct_of_current_annualized_revenue": net / annualized * 100,
        })

    base = next(row for row in totals if row["scenario"] == "base")
    sensitivity = []
    for scale in (D("0.75"), D("1.00"), D("1.25")):
        for fraction in (D("0.25"), D("0.50"), D("0.75")):
            lost = base["blocked_sales_usd_bn"] * scale * (1 - fraction)
            sensitivity.append({
                "exposure_scale": scale,
                "uniform_replacement_fraction": fraction,
                "net_loss_usd_bn": lost,
                "net_loss_usd_100m": lost * 10,
                "loss_pct_of_current_annualized_revenue": lost / annualized * 100,
            })

    profit = assumptions["profit_sensitivity_assumptions"]
    after_tax = 1 - D(profit["tax_rate"])
    earnings_low = base["net_loss_usd_bn"] * D(profit["incremental_operating_margin_low"]) * after_tax
    earnings_high = base["net_loss_usd_bn"] * D(profit["incremental_operating_margin_high"]) * after_tax
    shares = D(profit["diluted_shares_billion_approx"])
    summary = {
        "as_of": assumptions["as_of"],
        "money_unit": "USD billion",
        "current_quarter_annualized_revenue": annualized,
        "annualized_reference_is_forecast": False,
        "china_hq_quarter_revenue_pct": D(facts["china_hq_revenue"]) / D(facts["global_revenue"]) * 100,
        "china_hq_half_year_revenue_pct": D(facts["half_year_china_hq_revenue"]) / D(facts["half_year_global_revenue"]) * 100,
        "china_hopper_annualized_exclusive_upper_bound": D(facts["data_center_revenue"]) * D(facts["china_hopper_share_of_data_center_upper_bound_exclusive"]) * 4,
        "base": base,
        "base_profit_loss_low": earnings_low,
        "base_profit_loss_high": earnings_high,
        "base_eps_reduction_low": earnings_low / shares,
        "base_eps_reduction_high": earnings_high / shares,
        "timing_illustration_total": sum(D(row["net_loss"]) for row in assumptions["base_timing_illustration"]),
        "timing_illustration_first_six_months": sum(D(row["net_loss"]) for row in assumptions["base_timing_illustration"][:2]),
    }
    write_json("summary.json", summary)
    write_json("results.json", {"money_unit": "USD billion", "channels": channels, "scenarios": totals, "sensitivity": sensitivity})
    for row in totals:
        print(f"{row['label']}: loss=${row['net_loss_usd_bn']:.3f}bn, {row['loss_pct_of_current_annualized_revenue']:.2f}% of current annualized sales")
    print(f"Base blocked=${base['blocked_sales_usd_bn']}bn, replaced=${base['replacement_sales_usd_bn']}bn")
    print(f"Base earnings loss=${earnings_low:.3f}-${earnings_high:.3f}bn; EPS reduction=${earnings_low/shares:.3f}-${earnings_high/shares:.3f}")


if __name__ == "__main__":
    main()
