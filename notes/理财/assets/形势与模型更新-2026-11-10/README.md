# 2026-11-10形势与模型更新

行情截止美国2026-11-09常规收盘。新增11-06、11-09两个观察日，预测终点保留为2027-02-05，剩余60个交易日。

运行：

```bash
PYTHONPATH=/var/tmp/investment-quant-20261029-deps python 'notes/理财/assets/形势与模型更新-2026-11-10/update.py'
```

环境需安装numpy、pandas、matplotlib、requests。上方PYTHONPATH为本工作区既有的matplotlib依赖位置，在其他机器可按自己的环境调整。

- `raw/*.json`：冻结的Yahoo chart API响应。首次缺失才下载，重复执行读取缓存。
- `*.csv`：本轮增量下载区间的日线，解析后仅保留截至11-09的有效收盘。
- `manifest.json`：下载参数、原始响应哈希、所依赖的11月6日数据和模型哈希。
- `results/market_snapshot.csv`：最新价格、两个交易日变化及观察均线。
- `results/conditional_forecast.csv`：60日条件风险带。
- `results/original_scenarios_comparison.csv`：原绝对情景价格保持不变，从新价格计算剩余回报。
- `results/risk_model_change.csv`：本轮条件风险与原模型比较。
- `results/vendor_overlap_revisions.csv`：数据供应商对重叠日期的微小修订；合并历史时保留原冻结值。
- `update.png`、`update.pdf`：最新风险图；橙线是原主观基准，蓝线是条件模拟中位数，两者不是同一估值模型。

`update.py`导入同级`../三个月走势模型-2026-11-06/model.py`，沿用原参数和随机种子，仅将剩余期限设为60日；不调用原脚本主入口、不覆盖原结果、不重新调参或运行回测。原模型并未证明方向择时优势。

P10—P90是模型样本的条件期末分位数，未校准为真实概率或持有期间回撤边界。美元价格回报不含分红、汇率、税费。模型没有使用尚未发布的11-10 CPI。
