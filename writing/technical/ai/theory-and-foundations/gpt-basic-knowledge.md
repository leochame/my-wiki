# 通用名词解析

##### Hidden Size（隐藏层维度） 是什么意思？

**Hidden Size (h)** 就是大模型内部处理信息时，**用来表示一个 Token（词元）的向量维度**。



# AI Infra

## 模型推理

##### 1. 模型推理阶段怎么划分？

大模型（LLM）推理主要分为 **Prefill（预填充）** 和 **Decoding（解码）** 两个阶段。

- Prefill 阶段（计算密集型）：处理用户输入的 Prompt，一次性计算所有输入 Token 的计算并生成初始的 KV Cache。属于**计算密集型**。由于输入是并行的，可以充分利用 GPU 的算力，吞吐量高。
- Decoding 阶段（访存密集型）：逐个生成输出 Token。每生成一个新 Token，都需要读取之前的 KV Cache。属于**访存密集型**。每次只处理一个 Token，GPU 算力利用率低，瓶颈在于从显存读取 KV Cache 的带宽速度（Memory Bound）。

##### 2. 推理 OOM 的原因及排查

如果在推理时出现 OOM（显存溢出），通常涉及以下方面：

可能原因

1. **KV Cache 占用过高：** 随着序列长度（Context Length）增加，KV Cache 呈线性增长，耗尽显存。
2. **模型权重过大：** 未压缩的 FP16 模型权重占据了大部分基础显存。
3. **激活值（Activations）激增：** Batch Size 设置过大，导致中间层激活值超出限制。
4. **显存碎片化：** 频繁申请/释放变长序列导致显存无法利用。

如何排查

- **分段定位：** 先尝试 Batch Size = 1 且短序列输入，看是否是模型权重本身就太重。
- **显存监控：** 使用 `nvidia-smi` 或 `PyTorch Profiler` 观察显存增长趋势。
- **计算估算：** 静态显存（模型权重）+ 动态显存（KV Cache ≈2×layers×heads×dim×2 bytes）手动计算是否接近显存上限。

##### 5. vLLM 的 PagedAttention 原理

传统的 KV Cache 是连续存储的，为了应对变长输出，必须预分配最大长度的空间，导致严重的**显存碎片**（约 60%-80% 的浪费）。

借鉴操作系统内核的虚拟内存管理，将 KV Cache 划分为固定大小的 **Blocks（块）**。
物理上非连续存储，这些块可以分布在显存的任何地方；逻辑上，通过一个 **Block Table** 进行索引，将其映射为连续的序列。
动态按需分配，只有在产生新 Token 时才分配新的块，彻底解决了预留空间导致的浪费。
Copy-on-Write：支持多请求共享 Prompt（如并行采样），极大提升了高并发下的吞吐。

##### 6.  FLOPs 计算，
输入shape为(b,s,h)，详细计算MHA的计算量，包括self-attention和MLP部分

我们首先设定一个基本规则：**一次矩阵乘法 (m,n)×(n,k) 的计算量（FLOPs）为 2mnk**。
> 这里的 2 是因为每个位置涉及一次乘法和一次加法。

输入参数设定：
- b: Batch Size（批大小）
- s: Sequence Length（序列长度）
- h: Hidden Size（隐藏层维度）
- a: Number of Heads（注意力头数）
- d: Head Dimension（每个头的维度，d=h/a）

**MHA 计算量小计：** $6bsh^2 + 2bs^2h + 2bs^2h + 2bsh^2 = 8bsh^2 + 4bs^2h$
计算过程如下：
1. Q, K, V 的线性投影 (Linear Projection)，输入 (b,s,h) 分别乘以三个权重矩阵 $W_Q$​,$W_K$​,$W_V$​（每个矩阵形状均为 (h,h)）。
	- 单个矩阵乘法：$(b⋅s,h)×(h,h)→2⋅(b⋅s)⋅h⋅h=2bsh^2$
	- 三个矩阵总计：$3×2bsh^2=6bsh^2$
2. 计算注意力分数 (Score Calculation: $QK^T$)，将 Q,K 拆分为 a 个头，每个头维度为 d。对每个头进行矩阵乘法 $(s,d)×(d,s)$
	- 每个头的计算量：$2×s×d×s=2s^2d$
	- 全部 b 个 Batch 和 a 个头：$b×a×2s^2d=2bs^2(ad)=2bs^2h$
3. 计算加权和 (Weighted Sum: Score×V),注意力分数矩阵 ( s , s ) 与 V 的切片 ( s , d ) 相乘。
	- 每个头的计算量：$2×s×s×d=2s^2d$
	- 全部 b 个 Batch 和 a 个头：$b×a×2s^2d=2bs^2h$
4. 输出投影 (Output Projection)，最后将连接后的向量 (b,s,h) 通过 WO​ 矩阵 (h,h) 进行映射。
	- 计算量：$2×(b⋅s)×h×h=2bsh^2$

# GPT 模型的处理过程



# Function Call
Function Calling没有引入任何新推理机制，完全基于next token prediction，模型只是学会在特定场景下将输出切换为JSON格式。这是理解整个机制的核心！ 二、双阶段训练体系 1. 监督微调(SFT)阶段： - 通过完整对话链训练（系统提示→用户查询→工具调用→API响应→自然语言回复） - 模型掌握三要素： • 何时切换输出模式（概率性边界，非硬编码） • 如何生成标准JSON格式（通过海量样本内化） • 如何处理API返回结果（融入自然语言回复） 2. 强化学习(RL)阶段： - 评估四项关键指标： • 工具选择准确性 • 参数填充精确度 • 应调必调的及时性 • 不该调时的克制力 - 通过奖励机制优化，使调用质量显著提升 - 厂商能力差异主要源于这两阶段的数据质量与优化策略 三、运行时工作机制 1. Token级动态决策： - 词表含特殊标记<to call>（训练时扩展的新to...
