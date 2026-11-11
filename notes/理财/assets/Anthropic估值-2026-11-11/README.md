# Anthropic估值，2026-11-11

单位为十亿美元，股数单位为十亿股。`assumptions.json`明确区分已披露收入／股数与主观未来路径；`valuation.py`不拟合股价或发生概率。

```bash
PYTHONPATH=/var/tmp/investment-quant-20261029-deps python 'notes/理财/assets/Anthropic估值-2026-11-11/valuation.py'
```

除绘图需要numpy、matplotlib外，估值与CSV计算使用Python标准库。主结果见`results/dcf_scenarios.csv`，逐年路径见`results/annual_paths.csv`，敏感性见`results/sensitivity.csv`，发行价反推见`results/reverse_valuation.json`。

模型的重要限制：

- 2027—2036年现金流按年近似；2027年t=1。情景无校准概率。
- 股权桥接前／后分别近似为125／200十亿美元；发行后值条件是74美元发行及配售完成。它们不是逐笔审计的净债务值。
- 待转票据按权益进入相应稀释股数，不重复扣其重估账面负债；采购与租赁承诺需由现金成本吸收，不在DCF后全额重复扣除。
- 利润率为扣除持续训练、推理、渠道、人才经济成本、税费、资本投入及营运资金的自由现金流率。现有授予计入稀释，未来人才成本纳入利润率。
- 180.13亿稀释股数是74美元假设的固定参考；实际股价变化会改变配售与库存股法股数。未授予储备不全部计入。
- 2030市场池及份额是自定情景，不是Menlo市场数据，不与企业API份额混用。
- 资料见`sources_manifest.json`。HTTP403页面和返回占位PDF的下载未保存成有效原文；这些页面通过浏览工具核验，不把本地缺失解释为资料不存在。完整招股书保留E*TRADE刊载版。

`anthropic_S1A2.pdf`为E*TRADE刊载的11月10日修订招股书，同版SEC主文件链接列于研究笔记。PDF提取文本标记物理页码；股本表印刷页24对应物理第37页。软银图表第40页另存核对图。

可重新运行的模型保留参数哈希，源PDF保留下载哈希。未覆盖旧研究或修改账户。
