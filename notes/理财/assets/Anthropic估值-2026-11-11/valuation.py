"""Reproducible subjective cash-flow scenarios, not a price prediction model.

All financial units are USD billion. Frozen filing/market inputs are separate
from subjective forward assumptions in assumptions.json. No account access.
"""
from pathlib import Path
import csv
import json
import hashlib

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / 'assumptions.json').read_text())
OUT = ROOT / 'results'
OUT.mkdir(exist_ok=True)


def dcf(revenue, margins, rate, growth):
    assert len(revenue) == len(margins) == 10 and rate > growth
    flows = [sales * margin for sales, margin in zip(revenue, margins)]
    explicit = sum(flow / (1 + rate) ** (k + 1) for k, flow in enumerate(flows))
    terminal = flows[-1] * (1 + growth) / (rate - growth) / (1 + rate) ** 10
    return explicit + terminal, explicit, terminal, flows


def save(name, rows):
    with (OUT / name).open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    rows, annual = [], []
    for name, case in CONFIG['cases'].items():
        ev, explicit, terminal, flows = dcf(case['revenue'], case['fcff_margin'],
                                           case['discount_rate'], case['terminal_growth'])
        assert abs(case['serviceable_2030_lab_market'] * case['A_share_2030'] - case['revenue'][3]) < 1e-8
        rows.append({'case': name, 'revenue_2030': case['revenue'][3],
                     'revenue_2036': case['revenue'][-1], 'fcff_margin_2036': case['fcff_margin'][-1],
                     'discount_rate': case['discount_rate'], 'terminal_growth': case['terminal_growth'],
                     'enterprise_value': ev, 'explicit_cashflow_PV': explicit, 'terminal_PV': terminal,
                     'terminal_fraction_of_EV': terminal / ev,
                     'equity_pre_ipo_approx': ev + CONFIG['pre_ipo_cash_bridge'],
                     'equity_post_ipo_approx': ev + CONFIG['post_ipo_cash_bridge']})
        for year, sales, margin, flow in zip(CONFIG['years'], case['revenue'], case['fcff_margin'], flows):
            annual.append({'case': name, 'year': year, 'revenue': sales,
                           'fcff_margin': margin, 'fcff': flow,
                           'non_FCFF_cash_cost_envelope': sales - flow})
    save('dcf_scenarios.csv', rows)
    save('annual_paths.csv', annual)

    base = CONFIG['cases']['base']
    rates = [.11, .12, .13, .14, .15]
    scales = [.75, 1., 1.25, 1.5, 1.75]
    sensitivity = []
    for rate in rates:
        for scale in scales:
            ev, _, _, _ = dcf([r * scale for r in base['revenue']], base['fcff_margin'],
                              rate, base['terminal_growth'])
            sensitivity.append({'discount_rate': rate, 'revenue_path_multiplier': scale,
                                'equity_post_ipo': ev + CONFIG['post_ipo_cash_bridge']})
    save('sensitivity.csv', sensitivity)

    diluted = sum(CONFIG['diluted_share_components_at_74'].values())
    basic = CONFIG['basic_shares_billion_at_74']
    base_ev = next(row['enterprise_value'] for row in rows if row['case'] == 'base')
    issue_equity = 74 * diluted
    required_scale = (issue_equity - CONFIG['post_ipo_cash_bridge']) / base_ev
    reverse = {
        'diluted_economic_shares_billion_at_74': diluted,
        'equity_at_74_basic': 74 * basic,
        'equity_at_74_diluted': issue_equity,
        'equity_to_runrate_multiple_at_74_diluted': issue_equity / CONFIG['current_run_rate'],
        'base_EV': base_ev,
        'base_post_ipo_equity': base_ev + CONFIG['post_ipo_cash_bridge'],
        'base_post_ipo_equity_if_revenue_path_scaled_100_over_81': base_ev * 100 / 81 + CONFIG['post_ipo_cash_bridge'],
        'required_scale_to_justify_74_all_else_fixed': required_scale,
        'required_2030_A_revenue_at_74_all_else_fixed': base['revenue'][3] * required_scale,
        'required_2030_lab_market_at_35pct_share': base['revenue'][3] * required_scale / .35,
        'equivalent_price_for_base_at_constant_74_capitalization': (base_ev + CONFIG['post_ipo_cash_bridge']) / diluted,
        'warning': 'Reverse case assumes proportional revenue and FCFF at fixed margins, not an independent forecast. Constant capitalization is only a comparison; IPO-price-dependent share counts change.'
    }
    (OUT / 'reverse_valuation.json').write_text(json.dumps(reverse, indent=2))
    (OUT / 'model_manifest.json').write_text(json.dumps({
        'as_of': CONFIG['as_of'],
        'assumptions_sha256': hashlib.sha256((ROOT / 'assumptions.json').read_bytes()).hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'units': 'USD billion', 'no_fitted_probabilities': True}, indent=2))

    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False})
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), constrained_layout=True)
    colors = {'bear': '#a06055', 'base': '#29739a', 'bull': '#4b8a66'}
    for name, case in CONFIG['cases'].items():
        axes[0].plot(CONFIG['years'], case['revenue'], label=name.title(), color=colors[name], lw=2)
    axes[0].set_title('Subjective Anthropic revenue scenarios')
    axes[0].set_ylabel('USD billion per year')
    axes[0].set_xlabel('Calendar year')
    axes[0].grid(alpha=.15)
    axes[0].legend(frameon=False)
    grid = np.array([row['equity_post_ipo'] / 1000 for row in sensitivity]).reshape(len(rates), len(scales))
    ax = axes[1]
    im = ax.imshow(grid, cmap='YlGnBu', aspect='auto', vmin=0, vmax=2)
    ax.set_xticks(range(len(scales)), [f'{s:g}x' for s in scales])
    ax.set_yticks(range(len(rates)), [f'{r:.0%}' for r in rates])
    ax.set_xlabel('Entire base revenue path multiplier')
    ax.set_ylabel('Discount rate')
    ax.set_title('Post-IPO equity sensitivity (USD trillion)')
    for i in range(len(rates)):
        for j in range(len(scales)):
            ax.text(j, i, f'{grid[i,j]:.2f}', ha='center', va='center',
                    color='white' if grid[i,j] > 1.2 else '#152b3b')
    fig.colorbar(im, ax=ax, shrink=.8)
    fig.suptitle('2026-11-11 | cash-flow assumptions, not calibrated price probabilities', fontsize=12)
    fig.savefig(ROOT / 'valuation.png', dpi=170)
    fig.savefig(ROOT / 'valuation.pdf')
    plt.close(fig)
    print(json.dumps(rows, indent=2))
    print(json.dumps(reverse, indent=2))


if __name__ == '__main__':
    main()
