# KernelFoundry: Hardware-aware evolutionary GPU kernel optimization

arXiv:2603.12440v2 [cs.DC] · ICML 2026 (43rd) · Intel Corporation · 代码 Apache 2.0

- 作者：Nina Wiedemann\*, Quentin Leboutet\*, Michael Paulitsch, Diana Wofk, Benjamin Ummenhofer（\* 同等贡献）
- v1：2026-03-12；v2：2026-09-03（本次阅读版本，813 KB）
- 仓库：https://github.com/isl-org/kernelfoundry ｜ 文档：https://isl-org.github.io/kernelfoundry/

---

## 1. 30 秒总结

KernelFoundry 是一个**面向 kernel 生成的质量-多样性进化搜索框架**，模型权重全程冻结。它把"生成 kernel"从一次性对话改造成一个带档案库的搜索过程，并额外让**做生成指导的提示词本身也进入进化**：

1. **MAP-Elites**：按 kernel 特有的三个行为维度（内存访问 / 算法结构 / 并行协调）给候选分格，每格保留自己的最优，避免只留全局最快导致路线坍塌。
2. **历史梯度估计**：从"父→子"修改记录中估计每个方向的历史收益、成功率、探索缺口，用来选父代、也用来生成自然语言修改建议。
3. **模板参数优化**：LLM 只生成带参数的结构（tile、work-group size、unroll），具体取值由程序枚举实测。
4. **Meta-Prompter**：每隔 N 代，用生成结果反过来诊断并局部改写提示中的四段（优化原则 / 策略 / 常见陷阱 / 分析指导），提示变体同样进入档案库并按"用它生成过的最好 kernel"打分。

主结论：SYCL 在筛选后的 KernelBench（111 题）上**算术平均加速 2.32×、几何平均 1.38×**，正确率 0.97；CUDA 侧在 L2（20 题）上几何平均 1.73× 高于 AI CUDA Engineer 重测的 1.52×；robust-kbench 几何平均 5.30× 高于重测基线 3.50×。

值得记住的三点：**算术平均与几何平均差距很大（2.32 vs 1.38）**；**提示进化的收益存在但方差极大、单题回退不少**；**参数优化这一支柱的增益在噪声范围内**。

---

## 2. Problem：它认为主流方法错在哪

### 2.1 背景判断

- 高性能 kernel 依赖架构知识、并行策略、profiler 读数，是稀缺专家技能；LLM 的通用代码能力迁移不过去。
- **KernelBench 生态本身有病**：作者指出存在"错误但仍通过测试"的 kernel 刷出**高达 50× 的虚假加速**；他们用更严的测试（99% 输出相对误差 < 0.01）重测 HuggingFace 上 229 个已发表 kernel，**53 个未通过**。

后一条其实是比主方法更有公共价值的发现：benchmark 的正确性判据松，整个子领域的 SOTA 数字都不可比。

### 2.2 对主流方法的四点批评（§1–2）

主流范式被概括为：生成/修改 kernel → 编译 → 正确性检查 → 测速与 profiling → 反馈进上下文 → 再生成。多 Agent、进化算法、profiler 只是这个闭环的增强。作者的四点批评：

| # | 批评 | 具体所指 |
|---|---|---|
| 1 | **通用代码生成策略** | 没有针对 kernel 的特殊性：访存模式与并行结构到硬件的映射；没有对优化策略的系统性探索。设计空间靠通用生成隐式覆盖，且无法跨轨迹保留多样性。 |
| 2 | **模式坍塌** | 迭代精修本质是贪心局部搜索，LLM 持续产出近期成功解的近邻，过早收敛。 |
| 3 | **上下文污染/退化** | 历史变长后失败尝试主导提示，挤掉真正有用的信号。 |
| 4 | **评估与可移植性不足** | 几乎全部面向 CUDA；多数论文只报聚合数字不公开 kernel，结果强依赖硬件与模型可用性，无法公平比较——作者自己就因模型下线不得不砍掉部分基线（robust-kbench 缺 Sonnet 3.7，AI CUDA Engineer 只能用 o3-mini）。 |

### 2.3 相关工作定位（§2）

- 传统 autotuner（ATLAS/FFTW/AutoTVM/Ansor）：依赖学习到的代价模型，需要大量训练数据，跨硬件泛化差。
- 进化类：MAP-Elites、CMA-ME、PGA-MAP-Elites 是方法骨架。
- LLM+进化：FunSearch、AlphaEvolve、CodeEvolve（同时进化提示）、PACEvolve（点名 context pollution / mode collapse / 多岛协作弱）。v2 的差异点是"**为 kernel 设计的**行为维度 + 硬件感知"。

---

## 3. Method

### 3.1 主循环（§3.1）

组件：任务规格层（PyTorch 参考实现 / 自然语言 / 已有 kernel，pytest 兼容测试）→ 提示构造 → LLM 后端（OpenAI / Anthropic / vLLM，一次出多个候选）→ 编译与评估（SYCL 走 DPC++、CUDA 走 nvcc、Triton；正确性、计时、可选 unitrace/Nsight profiling）→ MAP-Elites 档案 + 独立的提示档案。

每代：采样父代 → 组装提示 → 生成 → 编译/测试/计时 → 静态分析给正确候选打行为坐标 → 若优于该格现有精英（或该格为空）则插入 → 所有结果（**含失败**）回流到梯度估计器与 meta-prompter。

### 3.2 MAP-Elites 与行为维度（§3.2）

三维、每维四档，4³ = **64 格**。坐标由**静态代码模式匹配**确定性计算（加权匹配、刻意避免相近模式重复计数），不是性能预测。

| 维度 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 访存 `d_mem` | 标量/跨步/非合并 | 合并/向量化（vec4、对齐） | 显式 tiling 的 shared/local memory | 多级：SLM + 寄存器分块 + 预取 |
| 算法结构 `d_algo` | 直译 PyTorch | 算子融合（单趟） | 算法改写（online normalization、flash 式） | 新算法或渐近改进 |
| 并行协调 `d_sync` | 无同步 | work-group barrier | sub-group 原语（shuffle/reduce/broadcast） | 全局协调（原子操作、多趟+同步） |

细节：用于 SLM 同步的 barrier 计入 `d_mem` 而非 `d_sync`。

适应度：

```
f(k) = 0            编译失败
     = 0.1          编过但结果错
     = 0.5 + 0.5·s_norm   正确，s_norm = min(1, speedup / target)，target 默认 2×
```

> **代码核对（v0.4.0）**：实际实现不是这条公式。`EvalResult.compute_performance_score` 返回 `perf_score + runtime_improvement`（`perf_score` 为 0–5 离散分，加速比直接相加、不截断），精英替换条件是严格大于。即代码里 2× 以上仍能继续替换精英。详见 §6 第 3 条。

父代选择四种策略：均匀 / 适应度比例 / **好奇心驱动**（偏向估计改进潜力高的格，默认）/ 多岛（K 个子群，每 M 代迁移）。

### 3.3 "梯度"：从修改历史估计下一步方向（§3.3）

用环形缓冲记录每次父→子转移：坐标 (b_p, b_c)、Δf = f_c − f_p、结果（改善/中性/退步）、时间戳与代数（用于时间衰减）。对每个格 b 计算三个信号：

```
∇_d F ≈ (1/|T|) Σ_{t∈T} Δf_t · sign(b_c^(d) − b_p^(d)) · w(t)     # 历史收益，指数时间衰减
∇_d R ≈ P(改善 | Δb_d > 0) − P(改善 | Δb_d < 0)                      # 方向成功率
∇_b E ∝ Σ_{c∈E} [(f_max − f_c)/‖c−b‖₁] · (c−b)/‖c−b‖₁               # 探索缺口（E: 空格 + 低质格）
∇_b   = α∇F + β∇R + γ∇E,   (α, β, γ) = (0.4, 0.4, 0.2)
```

两种用途：**选父代**（梯度模大的格更易被采样）；**转成自然语言建议**写进提示（如 d_mem 正梯度 → "为数据复用实现寄存器分块"）。

注意这确实是搜索历史上的启发式方向估计，不是对模型的反向传播，也没有正确性保证；三个权重是手调的。

### 3.4 模板参数优化（§3.4）

没有独立 tuner。LLM 可输出带参数的模板 kernel（work-group 维度、tile 大小、unroll 因子）+ 合法组合的 dispatch 函数；评估器识别模板、枚举配置、逐个编译验证计时，以最佳有效配置定义该候选的适应度，并记录全部结果供 LLM 后续改进参数。意义是**结构改动（生成）与数值搜索（实测评测）解耦**，改几个数字不必重写整份代码。

但附录 B.4 说明：40 代 SYCL 之后只跑 **2 代**参数优化。对应表格里的增益是 1.204→1.241（L1 均值）、2.051→2.104（L2 均值），robust-kbench 反而 12.107→12.081。**这是三大支柱里证据最弱的一条**，更像"低成本附加项"而非同等重要的贡献。

### 3.5 Meta-Prompter：让提示也进化（§3.5）

可改区域有四段，用分隔符标记：

1. 优化原则（高层次优先级）
2. 优化策略（按类别组织的技术、代码模式与解释）
3. 常见陷阱（反模式）
4. 分析指导（写代码前的推理脚手架）

回路：独立角色的 meta-prompter LLM 拿到「当前可编辑段落 + 生成的代码 + 指标（正确性/加速比/报错）」→ 诊断哪些指导缺失或误导 → 产出**限制在可编辑区域内的 SEARCH/REPLACE 补丁** → 用新提示继续生成 → 按生成结果评价该提示。

- 节奏：默认每 **10** 代一次；每次最多 3 个修改；提示档案容量 16；温度 0.3、max tokens 8000、top-p 1。
- 打分：某提示变体的适应度 = **使用它生成过的最好 kernel 的性能**（极其稀疏、噪声大）。
- kernel 档案与提示档案交错演化，灵感来自 CodeEvolve 与 GEPA。
- 实测观察：策略与陷阱两段改动最频繁，原则与分析指导相对稳定；典型新增是一条反模式（禁止把 host 指针 reinterpret_cast 成向量类型）和一条建议（小 kernel 尺寸时用共享内存直接卷积）。

**边界很重要**：被进化的是"给生成器的指令"，搜索算法、验证器、模型权重都没变。

---

## 4. Experiments

### 4.1 设置

- **KernelBench**：原始 250 题（L1 单算子 / L2 融合 / L3 完整结构）；按 Lange 等与 METR 的口径过滤后 **111 题（80 L1 + 31 L2，无 L3）**；多数实验用 **40 题子集（20+20）**。若用更宽松的过滤（保留条件 1/2/4）可保留 223 题。
- **robust-kbench**：19 题中的 12 题（有已发表最优 kernel 的那些，含反向算子）。
- **自定义任务**：YAML + pytest；含 Llama 3.2 1B 的 RoPE 案例；与 oneDNN 对比（concat+layernorm、MatMul+ReLU、MaxPool+Linear、Sum Reduction、Softmax）。
- **硬件**：集成 Intel Arc 140V（LNL）、独显 Battlemage B580、NVIDIA RTX A6000（CUDA 对比）。基线原数字来自 L40S（Kernelsseum）与 H100（AI CUDA Engineer、robust-kbench）。
- **软件**：DPC++ 2025.2、CUDA 12.8、Triton 3.5、PyTorch 2.9；unitrace 2.3、Nsight Compute 2025.3。
- **正确性判据**：99% 输出相对误差 < 0.01（严于 KernelBench 的绝对 1e-2）。
- **模型**：SYCL 用 GPT-4.1 + GPT-5-mini 等权，Sonnet-4.5 只在第 1 代；CUDA 对比用 o3-mini；robust-kbench 用 o3 / o4-mini / 4.1。
- **超参**：40 代 × 每代 4 分支（合计 160 个 kernel），好奇心选择，target 2.0×，提示每 10 代更新（每次最多 3 个 mutation，提示档案 16，温度 0.3 / max 8000 tokens）。

### 4.2 CUDA 主结果（Table 1，A6000，L1/L2 各 20 题）

| 方法 | 正确率 | fast1 | fast2 | 平均 | **几何平均** |
|---|---|---|---|---|---|
| L1 Kernelsseum | 0.65 | 15% | 0% | 0.765 | 0.600 |
| L1 AI CUDA Engineer（原文 H100） | 1.0 | 70% | 20% | 1.422 | 1.222 |
| L1 AI CUDA Engineer（重测） | 1.0 | 40% | 50% | 1.005 | 0.909 |
| **L1 Ours** | 1.0 | 55% | 10% | 1.204 | 1.092 |
| **L1 Ours + 参数优化** | 1.0 | 55% | 15% | 1.241 | 1.124 |
| L2 AI CUDA Engineer（重测） | 1.0 | 85% | 25% | 1.606 | 1.515 |
| **L2 Ours** | 1.0 | 90% | 40% | 2.051 | 1.680 |
| **L2 Ours + 参数优化** | 1.0 | 90% | 45% | 2.104 | 1.730 |
| robust-kbench 原文（H100） | 1.0 | 92% | 50% | 15.622 | 2.591 |
| robust-kbench 重测（A6000） | 1.0 | 92% | 58% | 8.865 | 3.499 |
| **robust-kbench Ours** | 1.0 | 100% | 67% | 12.107 | **5.295** |

### 4.3 SYCL 结果（Table 2）

- 111 题：正确率 0.97，fast1 71%，fast2 42%，**平均 2.32×，几何平均 1.38×**（这就是摘要里的 "2.3"）。
- 同一批任务用 CUDA 参考实现测得平均 1.49×。
- L2（n=20）与 OpenEvolve 对比：

| 设置 | fast1 | fast2 | 平均 | 几何平均 |
|---|---|---|---|---|
| OpenEvolve 40 代 | 70% | 40% | 2.535 | 1.775 |
| **Ours 40 代 + 参数** | 80% | 45% | 2.732 | **2.119** |
| OpenEvolve 10 代 | 70% | 20% | 1.483 | 1.202 |
| Ours 10 代 | 80% | 35% | 2.059 | 1.661 |
| Ours 20 代 | 70% | 50% | 2.539 | 1.833 |

### 4.4 消融（附录 F.4，Table 10，L2 n=20）

| 设置 | 平均 | 几何平均 |
|---|---|---|
| 无提示进化 | 2.505 | 1.600 |
| 每 10 代进化 | 2.539 | **1.833** |
| 每 2 代进化 | 2.542 | **1.944** |
| 无梯度指导 | 2.178 | 1.695 |

逐题看差异很大。**在两个进化设置下都比无进化更差的题**：24_Conv3d_Min_Softmax（1.504→1.089/1.098）、32_Conv2d_Scaling_Min（9.541→9.196/6.446）、47_Conv3d_Mish_Tanh（1.368→0.649/0.525）、50_ConvTranspose3d（2.617→1.221/2.972）、97_Matmul_BatchNorm（0.723→0.462/0.627）、99_Matmul_GELU_Softmax（5.324→2.657/2.787）。明显受益的：16（0.294→1.654）、35（2.759→8.717）、5_ConvTranspose2d（0.111→1.176）、73、82。

结论应当读作：**提示进化有系统性正收益，但是"平均改善 + 若干显著回退"的组合，不是每题都灵**。

### 4.5 硬件感知交叉实验（Table 3 / 附录 Table 11）

在 LNL 上优化的 kernel 拿到另一块卡上（以及反向）性能明显下降，几何平均从约 1.3 掉到约 1.0 量级，个别题出现反转（82 在 B580 上 hws 0.510、85 为 0.391）。作者自己的结论是：硬件感知有效但不完美。**这同时削弱了"SYCL 跨平台可移植"的叙事强度**——可移植的是代码，不是性能。

### 4.6 其他结果

- **oneDNN 对比**（Table 4）：concat+layernorm 1.79×、MatMul+ReLU 0.35×、MaxPool+Linear 0.72×、Sum Reduction 1.10×、Softmax 1.70×（后者给了用户提示 "参考 FlashAttention-4"）。**对成熟厂商库大多打不过**，这是诚实的负面数据。
- **Llama 3.2 1B RoPE 案例**：2 代拿到正确 kernel，10 代内 kernel 级 7.9×，整段 forward 从 0.413s → 0.38s（B580），端到端仅 8%。**kernel 加速到端到端的衰减**很典型。
- **弱模型**（附录 G，GPT-OSS 20B）：40 代 × 每代 4 个，**20 题中 7 题始终生成不出正确 kernel**（17/21/50/59/70/85/99），成功的多数也慢于基线（37: 0.043，73: 0.031，97: 0.069）。
- **收敛**：两个 100 代的例子在 80 代之后仍在改进（有 meta-prompting 时）。
- **成本**（附录 I）：平均 11.1k 输入 / 5.4k 输出 token per kernel；o3-mini 定价下约 **$5.74/kernel**（160 个/题），换 gpt-5.4 约 **$17.34/kernel**。对照 robust-kbench 约 $5、METR 最高约 $20。

---

## 5. 工程实现（仓库视角）

本地克隆：`papers/kernelfoundry/source/kernelfoundry`（v0.4.0，commit `0b23388`，2026-09-04，晚于论文 v2 一天；192 个文件，1.4 MB）。该目录含独立 `.git`，不应提交进本仓库。

两条使用路径，**共用同一套评测基础设施**：

- **MCP 模式**：`kernelfoundry.mcp_server` 暴露 `build_and_test(folder_path)` 与 `submit_task(folder_path)`，由 Copilot / Claude Code / Cursor 等编码 agent 当"生成器"，人机配合做修改-测试循环。
- **自主进化模式**：`python -m kernelfoundry.algorithm run task=... task_origin=KernelBench job_name=... gpu_arch=lnl language=SYCL`，走论文那套闭环。

任务落成"task package"：`config.yaml` + `task.py`（reference / fixtures / tests，`[REFERENCE_START]`…`[REFERENCE_END]`）+ kernel 源文件 + `conftest.py`。**只有 `[EVOLVE_START]`/`[EVOLVE_END]` 之间的区域允许被改写**——把"变异器可写边界"直接声明在被改写的产物里，这是一个挺值得抄的 harness 设计模式。

模块（据官方文档索引）：`algorithm/`（`agentic_controller`、`qd_gradient`、`prompts`、`evolve_database_optimization_aware`、`inference_server`、`schemas`）、`eval_pipeline/`（Celery 分布式任务、`database`、`profiler_feedback`）、`compiler/`、`gui/`（`roofline`、`kernel_graph`、`perfetto`）、`mcp_server/`。结果落在 `runs/kernels.sqlite3`。硬件档位 `lnl/ptl/bmg/dg2`（Intel）+ Ampere（NVIDIA 仅此档有专属 prompt 上下文与基线）；语言 SYCL/OCL/CUDA/triton。

---

## 6. 批判性评估

**站得住的部分**

1. **问题诊断准确且具体**：模式坍塌、上下文污染、只按 profiling 注入硬件信息，确实是当前 LLM kernel 生成的核心失效模式，且有 PACEvolve 等独立来源佐证。
2. **对基线做了重测**：在不公平的硬件/模型条件下重跑 AI CUDA Engineer 和 robust-kbench，而不是直接引用原文数字。这在同类论文里不常见，值得肯定。
3. **对 KernelBench 生态的体检**（53/229 已发表 kernel 不通过更严测试、"50× 虚假加速"）可能比主方法更有长期价值。
4. **提示进化的方向是对的且可复现**：把"改进 harness 的指令"作为一等公民、给提示单独建档案并用其下游产物的最好成绩打分，是一条干净的 credit assignment 路径。

**需要打折或存疑的部分**

1. **"2.3×" 是算术平均**。几何平均只有 1.38×，而对比 OpenEvolve 时用的却是几何平均（2.119 vs 1.775）。摘要选算术平均是最不好看的那个选择；同一篇论文内部指标口径不一致。
2. **robust-kbench 的"高 36%"跨了 GPU**：原数字来自 H100，他们的数字来自 A6000，重测基线 3.499 → 5.295 的对比才有意义（约 +51%），而"高 36%"这个数落在两个来源之间，口径不干净。
3. **论文的适应度公式与实际代码不一致**（读源码后修正，v0.4.0）。论文 §3.2 写的是 `f = 0.5 + 0.5·min(1, s/2)`，按此式 2× 以上全部饱和、格子会被永久锁死。但实现里 `schemas.py::EvalResult.compute_performance_score` 用的是 `score = perf_score + runtime_improvement`，没有上限截断；`evolve_database_optimization_aware.py` 的精英替换条件就是严格 `new_score > current_score`，`perf_score` 是 0–5 的离散质量分。所以**实际系统里 2× 以上的候选仍能替换精英，格子不会锁死**。论文正文的公式要么是简化表述、要么在 v1→v2 之间与代码脱节，值得作为"论文与实现不符"的案例记一笔。
4. **行为坐标是静态模式匹配**，可被 Goodhart：写出符合 d_mem=3 特征但实际更慢的代码，能占住稀缺格位。论文用了"避免重复计数"的加权匹配，但没有测量"坐标错误分类率"。
5. **单次运行、无误差线**：40 代进化 + LLM 采样温度 0.3，同一配置的方差可能就覆盖了 1.60→1.83 这种差距。消融给了逐题数字却不给多种子/置信区间，因此"提示进化有效"只能算**方向性证据**；有些题从 0.111 跳到 1.176、有的从 9.541 掉到 6.446，更像是方差而非机制。
6. **参数优化（第三支柱）收益在噪声内**：只有 2 代、均值差 3–5%、robust-kbench 上还倒退。摘要把它与另外两个并列，名不副实。
7. **与成熟库的对比不利**：oneDNN 上 5 个算子只有 2 个超过 1×，MatMul+ReLU 仅 0.35×。论文诚实报告了，但这也划出了能力边界——它擅长的是"PyTorch eager 这种弱基线"，不是"打败供应商库"。
8. **弱模型基本不可用**：GPT-OSS 20B 有 7/20 题连正确 kernel 都产不出。可迁移性依赖前沿闭源模型，`$5.7–17.3/kernel` 的成本也决定了它是"重要 kernel 的人工替代"，不是通用加速器。

---

## 7. 与 RSI 笔记（papers/2609.11873）的连接

按那篇综述的 B0–L5 框架，KernelFoundry v2 的精确定位是：

- **L2（策略自治）为主**：持久化对象是 kernel 与提示，AI 决定"下一步怎么改"；目标、任务边界、验收规则（pytest + 加速比）全部外部固定。
- **带一小片结构性 L5**：meta-prompter 修改的是**改进器的指令**，也就是 improver 的行为规范；但搜索算法、验证器、模型权重不动，所以是 structural 而非 effective L5。
- 按那篇笔记的合格评估标准，它缺的正是几项关键项：**冻结改进机制后的迁移测试、独立/保护评估器、同预算下与原始机制的对比、多种子轨迹与拒绝记录**。它做的恰好是"在同一个测试集上反复迭代"——benchmark 被直接当作优化目标，reward hacking 风险结构性存在（好在测试是固定且严格的，缓解了一部分）。
- 有意思的对照：它给出了一个**可度量的 harness 自改进幅度**——提示进化带来几何平均 1.60→1.83/1.94（约 +15%~+21%），但单题方差巨大、部分任务倒退。这个量级可以作为判断"改提示算不算真自改进"的参照点：**能改出增益，但增益小、不稳定、不可靠继承**。

可复用到自己工作里的三个点：

1. **可写边界声明在产物内**（`[EVOLVE_START]`/`[EVOLVE_END]`），比在外部配置里规定"允许改哪些文件"更难出错。
2. **结构生成与数值调参分离**：让 LLM 产出模板 + 枚举配置，用实测决定数值，是降低生成负担的通用手法。
3. **行为档案不等于性能档案**：用低维行为描述符保多样性，前提是描述符可靠且适应度不饱和；否则会退化成"用静态特征占坑"。若要用在自己项目里，应把适应度改成不封顶的单调函数。

---

## 8. 一句话结论

KernelFoundry v2 是目前把"质量-多样性搜索 + 提示自进化"接进 kernel 生成闭环做得最完整、工程最实的开源系统之一（内存/算法/同步三维档案 + 历史梯度 + 可写提示段 + 分布式评测 + MCP/agent 双模式）；但它证明的是**"提示自适应能稳定带来约 15–20% 的几何平均提升，同时伴随明显方差"**，而不是"持续、普适的递归自我改进"。用它的时候要盯几何平均而非摘要里的 2.3×，也要知道它在 oneDNN 级别的成熟库面前基本打不过。

---

## Sources

- arXiv HTML v2 全文：https://arxiv.org/html/2603.12440v2（§1–3 方法、§4–5 实验与附录 F.4/G/I）
- arXiv 摘要页（版本信息、ICML 2026 期刊引用）：https://arxiv.org/abs/2603.12440
- 仓库 README：https://github.com/isl-org/kernelfoundry
- 官方文档（模块索引 / Quickstart / task package）：https://isl-org.github.io/kernelfoundry/
- 源码（本地克隆，v0.4.0）：`papers/kernelfoundry/source/kernelfoundry`
  - `kernelfoundry/algorithm/schemas.py` — `EvalResult.compute_performance_score`，全系统唯一的性能打分口径
  - `kernelfoundry/algorithm/evolve_database_optimization_aware.py` — MAP-Elites 档案与精英替换（`get_main_score`、`add`）
  - `kernelfoundry/algorithm/qd_gradient.py` — 梯度估计
  - `kernelfoundry/algorithm/prompts/meta_prompting.py`、`prompt_evolution_integration.py` — meta-prompter
  - `kernelfoundry/algorithm/utils/score.py` — 模板参数合并与加速比统计
- 关联笔记：`papers/2609.11873/NOTES.md`（RSI 的 B0–L5 自治等级框架）
