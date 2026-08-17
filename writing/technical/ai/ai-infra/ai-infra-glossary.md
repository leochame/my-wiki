# AI Infra 术语

本文集中记录 AI Infra、GPU Kernel、训练与推理系统中常见的术语。每个词条尽量同时说明定义、执行层级、性能含义和实际算子中的用法。

## CTA（Cooperative Thread Array）

CTA 是 **Cooperative Thread Array** 的缩写。在 CUDA 语境中，通常可以将一个 CTA 理解为一个 **Thread Block（线程块）**：它们描述的是同一层级的线程协作与调度单元。CTA 这一叫法更常出现在 PTX、底层实现和性能分析工具中，而 CUDA C++ 编程接口通常使用 Thread Block。

### 执行层级

```text
Grid
 └── CTA / Thread Block
      └── Warp
           └── Thread
```

一个 CTA：

- 由多个线程组成，线程在硬件执行时通常按 warp 组织；
- 会被调度到一个 SM 上执行，且执行期间不会跨 SM 迁移；
- CTA 内线程可以共享 shared memory，并使用 block 级同步；
- 会占用 SM 上的 register、shared memory、warp slot 和 block slot 等资源；
- CTA 的数量、大小和单 CTA 资源消耗会共同影响 occupancy、并行度与尾部等待。

多个 CTA 可以先后或同时在同一个 SM 上执行，但同一时刻能够驻留多少个 CTA，受以下因素限制：

- 每个 CTA 的线程数和 warp 数；
- 每个线程使用的 register 数量；
- 每个 CTA 使用的 shared memory；
- GPU 架构提供的每 SM 最大 thread、warp 和 CTA 数量。

### MLA Decode 中的例子

在拆分执行的 MLA decode kernel 中，可以按输出工作量启动不同数量的 CTA。例如：

```text
_split_kernel:  batch_size × num_splits 个 CTA
_reduce_kernel: batch_size × output_tiles 个 CTA
```

`_split_kernel` 将每个请求的计算拆成 `num_splits` 份，以增加可并行调度的 CTA；`_reduce_kernel` 再按输出 tile 合并中间结果。

- CTA 太少时，可运行的线程块不足以覆盖所有 SM，GPU 可能无法得到充分利用；
- CTA 太多时，虽然并行任务更多，但可能增加调度、中间结果写回、reduce 工作量和额外访存；
- CTA 数量足够也不代表 occupancy 一定高，单个 CTA 的 register 或 shared memory 消耗仍可能限制每个 SM 的 active CTA 数量。

因此，profile 中的 **CTA 数量**、**CTA/SM** 和 **CTA underfill**，本质上是在分析线程块级别的并行度、资源占用以及工作是否足以填满 GPU。它们需要与 kernel 时长、active warps、register、shared memory 和内存吞吐等指标一起判断，不能单独作为性能结论。

## MLA Decode 调优术语

### Chunk：单次处理多少个 KV Token

在 attention kernel 中，`chunk` 通常表示一个程序实例或一个计算阶段一次处理的 **KV token 数量**。长 KV 序列会沿 sequence 维切成多个 chunk：

```text
KV sequence
 ├── chunk 0：处理一段 KV token
 ├── chunk 1：处理一段 KV token
 └── chunk 2：处理一段 KV token
```

chunk size 是典型的性能调节参数：

- chunk 太小时，任务数量和调度开销增加，循环与边界处理也更频繁；
- chunk 太大时，单个程序需要更多 register 或 shared memory，可能降低 occupancy；
- 合适的 chunk size 需要在数据复用、并行度、资源占用和 reduce 开销之间权衡。

这里的 chunk 不等同于 split。chunk 更强调一个程序内部每轮消费的数据粒度；split/segment 则强调把整条 KV 序列分成可由多个 producer 并行处理的任务。具体实现有时会让两者重合，因此仍应以 kernel 的索引方式为准。

### Compact Probability：只保留需要参与 PV 的 Attention 权重

标准 attention 的逻辑数据流是：

```text
QK
 -> softmax
 -> probability P
 -> P x V
 -> output
```

完整保存 probability 矩阵会消耗大量显存容量和带宽。这里的 **Compact probability** 不只是降低 probability 的数值精度，而是只保留后续 `P x V` 真正需要的 probability，并将权重及其对应的 KV 索引紧凑保存。没有被保留的 QK/probability 不会再读取对应的 V，也不会参与 PV 运算。

一种分块的数据流可以表示为：

```text
chunk 0：计算 QK / probability -> 筛选并 compact
chunk 1：计算 QK / probability -> 筛选并 compact
chunk 2：计算 QK / probability -> 筛选并 compact
 -> 读取 compact probability 及 KV index
 -> gather 被保留位置的 V
 -> 只计算被保留的 probability x V
```

因此，即使 QK 阶段计算了较多甚至全部候选位置，也不代表所有 QK 都会进入 V 阶段。Compact probability 将 QK/softmax 与 PV 解耦：前一阶段负责产生和筛选权重，后一阶段只消费紧凑列表中的 `(probability, KV index)`，从而减少 V 的读取量与乘加量。

需要区分两个可能的算法语义：实现可以先对全部有效 QK 做 softmax，再筛选 probability；也可以先用 top-k、阈值或 mask 选出候选位置，再只在候选集合上归一化。两者得到的 attention 分布不同，具体属于哪一种必须以实现中的筛选与归一化顺序为准。

FlashAttention 风格的融合 kernel 往往在片上完成 softmax 和 `P x V`，根本不把完整 P 写回显存。此时应区分“片上短暂保存 probability”和“将 compact probability 作为跨阶段中间结果保存”这两种设计。

### Head 调参：一个程序同时处理几个 Attention Head

MLA 或多头 attention 中，一个 kernel program 可以只处理一个 head，也可以把多个 head 组合到同一个 program 中。一次处理的 head 数会改变并行任务数量、Q/K/V 数据复用和资源占用：

- 每次处理较少 head：program 数量更多，并行度通常更高，但共享数据的复用较少；
- 每次处理较多 head：可以复用公共的 KV 数据或加载结果，但会增加单个 program 的 register、shared memory 和计算量；
- 当 batch 较小或 KV head 较少时，组合过多 head 可能造成可调度任务不足；
- 当 kernel 受访存限制时，适度组合 head 可能通过数据复用提高效率。

因此，head 调参不是简单地“越多越好”，而是在 program 并行度、数据复用和单 program 资源压力之间寻找平衡。

### Persistent Kernel：让少量 Program 持续领取任务

普通 kernel 的执行方式通常是：

```text
启动 program
 -> 完成一个固定任务
 -> 结束
```

Persistent kernel 则启动数量较少、长期驻留在 SM 上的 program，并让它们循环领取多个逻辑任务：

```text
启动少量常驻 program
 -> 领取任务 0
 -> 领取任务 1
 -> 领取任务 2
 -> ...
 -> 所有任务完成后退出
```

这种设计可以减少大量短任务的启动与调度开销，并通过动态领任务改善不同 sequence length 带来的负载不均衡。但常驻 program 会长期占用 register 和 shared memory；program 数量、每个 program 同时处理的 head 数，以及任务领取粒度都需要共同调节。

#### Persistent Kernel 与 CUDA Graph 的区别

两者优化的层级不同：**Persistent kernel 改变单个 kernel 内部消费任务的方式，CUDA Graph 改变 CPU 向 GPU 提交一串操作的方式。**

```text
普通执行：
CPU -> launch kernel A -> launch kernel B -> launch kernel C

CUDA Graph：
CPU -> replay graph
GPU -> kernel A -> kernel B -> kernel C

Persistent kernel：
CPU -> launch kernel P
GPU -> P 常驻并循环领取 task 0、task 1、task 2...
```

CUDA Graph 将多个 kernel、memcpy 等操作预先记录为一张执行图，之后由 CPU 以一次 replay 提交，从而减少逐个 launch 的 CPU 开销。图中的 kernel 通常仍然各自启动、执行并结束，也不会因为处于 CUDA Graph 中就长期占用 SM。

Persistent kernel 则让少量 program 长时间驻留在 GPU 上，由它们通过任务队列或计数器持续领取逻辑任务。它不仅能减少细粒度任务的重复调度，还能在 GPU 内动态平衡不同 sequence length 带来的工作量差异；代价是长期占用 register、shared memory 和 SM 执行资源，kernel 实现也更复杂。

```text
CUDA Graph 解决：CPU 如何高效提交一组 GPU 工作
Persistent kernel 解决：GPU kernel 如何持续消费许多逻辑任务
```

两者不是互斥方案，可以组合使用。例如，一次 CUDA Graph replay 可以提交完整的 MLA decode 流程，而图中的 split-KV producer 节点本身可以是 persistent kernel。

### Split-KV Producer / Reducer

当单条请求的 KV 序列很长时，只让一个 program 处理整条序列会限制并行度。Split-KV 将长 KV 序列切成多个 segment，让多个 producer 并行处理同一个 sequence：

```text
KV sequence
 ├── segment 0 -> producer 0 -> partial O_0, m_0, l_0
 ├── segment 1 -> producer 1 -> partial O_1, m_1, l_1
 └── segment 2 -> producer 2 -> partial O_2, m_2, l_2
                                  |
                                  v
                              reducer
                                  |
                                  v
                              final O
```

每个 producer 只负责自己的 KV segment，典型数据流为：

```text
QK_NOPE + QK_PE
 -> online softmax
 -> probability x V
 -> partial O, m, l
```

其中：

- `QK_NOPE` 是 query 与不含位置编码部分的 key 的点积；
- `QK_PE` 是 query 与携带位置编码部分的 key 的点积；
- `m` 是该 segment 内 softmax logit 的最大值；
- `l` 是以 `m` 为基准计算的指数和；
- `partial O` 是该 segment 在局部 softmax 标度下累积的 value 输出。

不同 segment 的 `(partial O, m, l)` 使用了各自的局部 softmax 标度，不能直接相加。Reducer 先求全局最大值，再对各 segment 的统计量和输出重新缩放：

```text
m = max_i(m_i)
l = sum_i(exp(m_i - m) * l_i)
O = sum_i(exp(m_i - m) * partial_O_i) / l
```

Split-KV 增加了同一 sequence 内部的并行度，尤其适合长上下文或 batch 较小的 decode；代价是需要写回 partial results，并额外启动或执行 reducer。segment 太少时并行度不足，太多时中间结果、同步和 reduce 开销会上升。
