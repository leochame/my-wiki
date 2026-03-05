# Sytem Design - LLM interface

大模型（LLM）推理主要分为 **Prefill（预填充）** 和 **Decoding（解码）** 两个阶段。

- Prefill 阶段（计算密集型）：处理用户输入的 Prompt，一次性计算所有输入 Token 的计算并生成初始的 KV Cache。属于**计算密集型**。由于输入是并行的，可以充分利用 GPU 的算力，吞吐量高。
- Decoding 阶段（访存密集型）：逐个生成输出 Token。每生成一个新 Token，都需要读取之前的 KV Cache。属于**访存密集型**。每次只处理一个 Token，GPU 算力利用率低，瓶颈在于从显存读取 KV Cache 的带宽速度（Memory Bound）。

## 1. 什么是KV Cache

Transformer 模型的自回归（Auto-regressive）特性导致了显著的计算冗余。模型每生成一个新 token，都要处理一遍已有的所有输入，这导致了 O(N2) 的计算复杂度增长。

 Attention 运算 Q×K_T 中，由于历史 token 的 K 和 V 在生成过程中是不变的，我们只需将其缓存在显存（VRAM）中。当生成第 n+1 个 token 时，系统仅计算该 token 的 Q，并与缓存中的历史 K,V 进行点积。这种“以空间换时间”的方案是目前解决 Token-by-token 生成效率的唯一通路。

## 2. 显存占用的量化分析与计算

以 Llama_2 ,7B, FP16, 32 Layers为例:

模型权重 (Weights)： 7B × 2 Bytes（FP16）≈ 14GB。

 KV cache / token = 2(K and V)×Layers (32) × Hidden Dimension (4096) × 2 Bytes（FP16） = 512KB / token

单会话（4K 上下文）KV Cache 总占用：4096×512KB≈2GB。

 在一张 80GB 的 A100 显卡上，可用空间为 80GB − 14GB = 66GB

理论并发上限： 66GB/2GB=33 sessions。
但是33 个并发是理想上限。实际上由于 Activation Memory 的占用以及 KV 碎片的产生，实际并发通常会缩水 10%-20%。

----

Llama 3 8B 引入了 GQA（分组查询注意力）。其 KV Head 数量从 32 减少到 8。

`head_dim` = `隐藏层总维度 (d_dim)` ÷ `查询头数量 (Q_heads)` （多头注意力机制）

计算公式变为：2 × 32 layers × 8 heads × 128 (head_dim) × 2 bytes = 128KB  /  token。

这意味着单会话显存占用从 2GB 降至 1GB，并发上限直接翻倍至 64 以上。

---

至少用也是 70B 的模型。70B 的模型比两张卡都大。

naive batching -> continues batching

Prefill VS Decode

continus batching是一种 Cell-level 的智能调度机制。系统不再按批等待，而是每完成一次迭代，就检查是否有任务结束。只要 GPU 显存有空位，立即从队列中插入新任务的 Prefill 阶段。这种方式彻底消除了 GPU 的空闲等待
 当超长 Prompt 进入时，它会瞬间霸占计算资源。通过“强占式调度”思想，将长 Prefill 切分为多个 Chunk，在 Chunk 之间穿插其他任务的 Decode 步骤。这有效地解决了长序列导致的任务阻塞.

但是切片也只是模仿 OS 的抢占机制，本质上还是牺牲了某个请求的执行时间。

## 3. PD 分离

PD 分离后可以分别优化这两个 Node。
可以启动 CUDA Graph 来减少  Decode 阶段 的 CPU 的开销。
> GPU  执行的任务都是CPU 派发的，Decode 每次都是生成单 Token 又很快，所以 GPU 需要等待 CPU 分发任务。

通过 capture 计算图并 Replay，压缩通信次数。
这样就可以根据业务 Prompt 的平均长度动态调整 Prefill Node and Decode node 比例。

但是跨节点传输是有消耗的。
reduce KV cache
- Paged Attention 减少内存碎片，也可以只传输 PageTable 和 活跃的Block，不活跃的延迟拉去
- Prefix Sharing 与 Smart Router（去重）：在多轮对话或同提示词场景下，通过 Smart Router 识别请求前缀，将相同前缀的请求路由至持有对应 KV 缓存的特定节点，只需要传输不同的差量页。
- Compression: （流式编码）Cache Gen、稀疏化（Sliding window attention），low rank，纬度共享
PD 分离依赖 RDMA v2 或 InfiniBand。
Streaming Pipeline (算传并行)：Prefill 节点每算出一层或一个块，就立即向 Decode 节点异步推送，实现计算与传输的重叠。

当面对 70B 及以上规模模型，或 128K 以上的超长上下文（如 DeepSeek V3/Llama 4）时，单卡架构彻底崩溃。

- 张量并行 (TP, Tensor Parallelism) 可以将一个GPU 放不下的计算放到多个 GPU，本质上还是拆分一个矩阵：
    - 但是代价就是每一层 transformer 内部需要 2 次 All-Reduce 同步。
    - 还有就是Small Message Inefficiency（短消息低效）。在 NVLink 环境下，如果传输的消息体小于 1MB（Decode 阶段常见），通信延迟将显著抵消计算加速效果。
- 专家并行 (EP, Expert Parallelism)：针对 MoE 模型，只有被激活的专家参与生成。专家并行可以将不同的专家部署到不同的GPU 上去。若某些“热门专家”被过度调用，会导致单卡过热而其他卡闲置。需在推理侧引入动态路由优化。
- 上下文并行 (CP, Context Parallel)： 面对超长上下文，单卡 Prefill 的 O(N2) 计算将导致显存爆炸。此时需利用 Ring Attention 配合 FlashAttention，将长序列切分到多张卡，通过环形拓扑传递中间状态，打破单卡显存墙。