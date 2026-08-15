# AI infra 训练路线：急功近利版，从 FlashAttention 到 Flash MLA

## 这件事为什么难

Infra 面试段子里的顺序很有代表性：FlashAttention、Backward、PagedAttention、训推一体、Flash MLA 看起来像五道题，实际上跨越了几层能力：

1. 能否写出正确的 GPU Kernel。
2. 能否理解内存、线程、同步和硬件执行模型。
3. 能否用 profiler 找到真正的瓶颈。
4. 能否把单个算子放进训练或推理系统。
5. 能否在不同硬件和后端之间迁移抽象。

因此，这份路线分成两段：先用 32 周快速获得能写算子、能做推理系统、能解释性能的主线能力；再回头补 C/C++、底层 CUDA 和系统化性能分析。这样既能尽快接触 AI infra 的核心问题，也不放弃后续夯实底层能力。

## 总目标

默认每周投入 15～20 小时，周期约 8 个月。最终形成一个能够展示的实验仓库，而不是一堆看过的课程和论文：

- 从零实现并优化一组基础 GPU 算子。
- 实现 FlashAttention 的前向和反向。
- 实现支持 KV Cache 的简化版 PagedAttention。
- 理解训练与推理中的并行、通信和调度。
- 实现一个简化版 MLA 的 Prefill / Decode 路径。
- 至少把一个算子迁移到另一种后端或 NPU 开发模型。

## 当前执行版本

前 32 周采用急功近利路线。每个阶段都以可运行产出为中心，先形成 FlashAttention、PagedAttention 和 MLA 的完整认知，再补充更深的硬件细节。

| 阶段 | 周数 | 核心内容 | 必须产出 |
|---|---:|---|---|
| 0. 基础与环境 | 1～2 | CUDA 编程模型、显存层次、线程组织、PyTorch Extension | CUDA 环境、基准测试框架 |
| 1. GPU Kernel 基础 | 3～6 | Reduce、Softmax、LayerNorm、GEMM、Memory Coalescing、Shared Memory | 5～8 个基础 Kernel |
| 2. FlashAttention Forward | 7～10 | Tiling、Online Softmax、IO Awareness、Causal Mask、FP16/BF16 | 可运行的 FlashAttention 前向 |
| 3. Backward | 11～14 | 反向公式、dQ/dK/dV、数值稳定性、Autograd 接口 | 支持训练的 FlashAttention |
| 4. PagedAttention | 15～18 | KV Cache、Block Table、Prefill、Decode、Continuous Batching | 简化版推理引擎 |
| 5. 训推一体 | 19～22 | DDP、FSDP、NCCL、Tensor Parallel、Checkpoint、通信隐藏 | 多卡训练与推理 Demo |
| 6. MLA / Flash MLA | 23～26 | MQA/GQA、Latent KV、RoPE、Prefill/Decode 路径 | 简化版 Flash MLA |
| 7. 系统工程 | 27～30 | Scheduler、Quantization、Profiling、容错、服务化 | 可压测的 LLM Serving Demo |
| 8. NPU 与作品集 | 31～32 | 算子迁移、后端抽象、NPU DSL / Custom Op | CUDA 与 NPU 对比报告 |

## 总路线

```text
基础与环境
    -> GPU Kernel 基础
    -> FlashAttention Forward
    -> FlashAttention Backward
    -> PagedAttention
    -> 训推一体
    -> MLA / Flash MLA
    -> 系统工程
    -> NPU 与作品集
    -> 古法补强
```

## 阶段 0：基础与环境（第 1～2 周）

这一阶段只补足后续开发所需的最小知识，不展开完整的 C++ 或 GPU 体系：

- CUDA Grid、Block、Warp、Thread 的基本关系。
- Global Memory、Shared Memory、Register 的基本区别。
- GPU、CUDA Toolkit、PyTorch Extension 环境。
- CUDA Event、Warmup、同步和重复计时。
- PyTorch Reference、Custom Op 和基础测试框架。

必须完成：

- 跑通一个 CUDA Vector Add。
- 跑通一个 PyTorch Custom Op。
- 建立 correctness test 和 benchmark 模板。
- 记录 GPU 型号、输入 Shape、数据类型和延迟。

古法 C/C++、Cache 和 `perf` 暂时只保留为后置补强内容。

## 阶段一：GPU Kernel 基础（第 3～6 周）

目标是快速积累足够多的 Kernel 经验，为 Attention 做准备：

- Grid、Block、Warp、Thread。
- Global Memory、Shared Memory 和 Register。
- Coalesced Memory Access。
- Bank Conflict。
- Warp Shuffle 和 Atomic。
- Stream、Event 和异步执行。
- Host / Device 数据传输。

建议按以下顺序实现：

1. Vector Add
2. SAXPY
3. Reduce Sum
4. Histogram
5. Transpose
6. Softmax
7. LayerNorm
8. Tiled GEMM
9. Naive Attention

每个算子都保留三个版本：

```text
CPU Reference
Naive GPU Version
Optimized GPU Version
```

这样才能看清优化改变了什么，而不是只得到一份“能跑”的代码。

## 阶段二：FlashAttention Forward（第 7～10 周）

先实现正确版本，再做 IO-aware 优化。需要理解：

- 为什么标准 Attention 会物化巨大的 Attention Matrix。
- Tiling 如何减少 HBM 读写。
- Online Softmax 如何维护局部统计量。
- Q、K、V 如何分块加载。
- Causal Mask 如何处理边界块。
- Prefill 和 Decode 的访问模式为什么不同。

第一版只支持固定 Shape、Causal Attention、FP16 输入和 FP32 累加；之后再加入 Variable Length、Mask、GQA / MQA 和 BF16。

建议保留四层实现：

```text
PyTorch Reference
    -> Naive CUDA Attention
    -> Tiled CUDA Attention
    -> FlashAttention-like Kernel
```

## 阶段三：Backward（第 11～14 周）

需要自己推导并实现 `dQ`、`dK`、`dV`，再用 reference backward、`gradcheck` 和随机输入验证。不要只依赖 PyTorch Autograd 生成反向实现。

重点处理：

- Softmax 的反向传播。
- Causal Mask 的梯度。
- Recomputation 与保存中间结果的取舍。
- FP16 / BF16 输入下的 FP32 累加。
- 非整除 Tile Size 和极端值。

## 阶段四：PagedAttention 与推理系统（第 15～18 周）

需要理解：

- KV Cache 为什么会造成显存碎片。
- Page / Block Table 如何把逻辑序列映射到物理显存。
- Prefill 和 Decode 为什么需要不同 Kernel。
- 不同长度请求如何组成 batch。
- Continuous Batching 如何动态加入和退出请求。
- Prefix Cache、Sliding Window 和 Speculative Decoding 的基本思想。

实现一个简化推理引擎：

```text
请求进入
    -> Scheduler 组成 batch
    -> Prefill 写入 KV Cache
    -> Decode 读取 Paged KV Cache
    -> 生成一个 token
    -> 更新 Block Table
    -> 请求完成后释放 block
```

验收内容：

- 多请求并发时结果正确。
- KV Cache 不要求物理连续。
- 支持不同长度请求。
- 统计 token/s、首 token 延迟和 Decode 延迟。
- 绘制显存使用量随请求数变化的曲线。

## 阶段五：训推一体与分布式（第 19～22 周）

“训推一体”不是把训练和推理代码放在一个仓库，而是尽可能复用模型结构、算子、权重格式、并行策略和通信原语。

需要掌握：

- `torch.distributed` 和 NCCL Collective。
- DDP、FSDP / ZeRO 的基本思想。
- Tensor Parallel 和 Pipeline Parallel。
- Gradient Accumulation。
- Activation Checkpointing。
- Mixed Precision。
- Checkpoint Sharding。

至少完成：

1. 两张 GPU 上训练一个小型 Transformer。
2. Tensor Parallel 推理同一个模型。

能够解释 AllReduce 的瓶颈、FSDP 的显存收益，以及通信如何与计算重叠。

## 阶段六：MLA / Flash MLA（第 23～26 周）

学习顺序：

```text
MHA -> MQA -> GQA -> KV Compression -> Latent KV -> RoPE -> MLA
```

重点理解：

- MLA 为什么可以减少 KV Cache。
- 压缩后的 Latent KV 如何参与注意力计算。
- RoPE 相关部分为什么需要特殊处理。
- Prefill 和 Decode 的 Kernel 结构为什么不同。
- 减少计算量是否一定会降低端到端延迟。

先完成数学上正确的 MLA reference，再实现固定 Shape 的 Flash MLA，最后比较普通 MHA、GQA 和 MLA 的显存与速度。

## 阶段七：系统工程（第 27～30 周）

把前面的算子和推理能力组合成一个可压测的 Serving Demo：

- Scheduler 和请求生命周期。
- Continuous Batching 的调度策略。
- Quantization 的基本路径和精度验证。
- CUDA Graph 对 Decode 的适用场景。
- Profiling、指标采集和故障定位。
- 超时、取消、显存不足和请求隔离。
- 服务化接口、压测和延迟分位数。

必须产出：

- 一个可启动的 LLM Serving Demo。
- 一套并发压测脚本。
- 首 token 延迟、Decode 延迟、吞吐和显存曲线。
- 一份瓶颈分析报告。

## 阶段八：NPU 与作品集（第 31～32 周）

“不限制 CUDA-C”不等于跳过 CUDA，而是不能只会一种后端。建议掌握 CUDA C++、Triton、CUTLASS / CuTe，并选择一个 NPU 平台了解 DSL 或 Custom Op。

迁移时抽象为：

```text
算子语义
    -> Tensor Layout
    -> Tile Strategy
    -> Memory Movement
    -> Reduction
    -> Backend Implementation
```

最终写一份对比报告：

- CUDA 与 NPU 的硬件差异。
- 执行单元和内存层次的对应关系。
- 同一个 Attention Kernel 为什么不能直接迁移。
- 哪些部分适合 Triton，哪些部分必须使用底层 Kernel。

最终产出：

- 至少一个可迁移的算子。
- CUDA 与 NPU 的实现或接口对比。
- 一份后端抽象说明。

## 古法补强期（主线之后，建议 6～10 周）

主线完成后再系统补底层，重点从“知道怎么调用”推进到“知道硬件为什么这样跑”。

### C/C++ 与机器基础

- 指针、数组、结构体、模板和 RAII。
- 编译、链接、静态库和动态库。
- Cache、Memory Hierarchy 和局部性。
- SIMD、分支预测和数据布局。
- `gdb`、`perf`、`objdump`。
- Debug / Release 编译差异。

建议重写：向量加法、矩阵转置、卷积、Naive GEMM、多线程 Reduce，以及 Cache-friendly / Cache-unfriendly 两个版本。

### 深入 CUDA

- Coalesced Memory Access。
- Bank Conflict。
- Warp Shuffle 和 Atomic。
- Occupancy、Register Pressure 和 Shared Memory。
- Stream、Event 和异步执行。
- Kernel Launch Overhead。

把之前的算子全部保留三个版本：

```text
CPU Reference
Naive GPU Version
Optimized GPU Version
```

### 系统化性能分析

形成固定闭环：

```text
提出假设
    -> 设计 microbenchmark
    -> 采集指标
    -> 对照理论模型
    -> 修改实现
    -> 重新验证
```

需要补齐 Roofline Model、Nsight Systems、Nsight Compute、Memory Throughput、Compute Throughput、Warp Stall 和 GPU 利用率分析。每次实验都记录 GPU 型号、输入 Shape、数据类型、Warmup、重复次数、平均延迟、P50 / P95、带宽和主要 Stall 原因。

这个阶段的目标不是再做一遍面试题，而是解释主线项目中的性能现象：为什么某个 Tile 更快，为什么 Decode 是 Memory Bound，为什么某个优化在 Prefill 有效但在 Decode 无效。

## 推荐资料与仓库内关联笔记

### Modern GPU Programming For MLSys

[Modern GPU Programming For MLSys](https://mlc.ai/modern-gpu-programming-for-mlsys/index.html) 适合作为第 1～6 周的主线课程，并可在古法补强期回看。不要只看材料，要完成练习，并把每个练习改造成自己的 benchmark。

### FlashAttention-2 in CuTe From Scratch

[FlashAttention-2 in CuTe From Scratch](https://blog.echen.io/p/flashattention-2-in-cute-from-scratch/) 适合放在 FlashAttention 前向之后、古法补强期重点回看。重点不是照抄代码，而是理解 Layout、Tile、Warp、Shared Memory 和 Tensor Memory Access 如何对应硬件执行。

### Ashraf Bhuiyan Blog

[Ashraf Bhuiyan Blog](https://ashraf-bhuiyan.com/blog) 可作为 GPU Kernel、CUDA 性能分析和 ML Systems 的补充阅读。建议采用“反向实现”：先看问题和 benchmark，自己写一版，再对照作者实现并记录差异。

### Vault 内关联笔记

- [[writing/technical/ai/ai-infra/gpu|GPU 执行与性能]]
- [[writing/technical/ai/ai-infra/triton-kernel|Triton Kernel]]
- [[writing/technical/ai/ai-infra/ai-infra-llm-interface|LLM 推理接口与系统设计]]

## 作品集形态

最终建议形成一个独立实验仓库：

```text
ai-infra-lab/
  kernels/
    softmax/
    layernorm/
    flash_attention/
    flash_mla/
  runtime/
    kv_cache/
    paged_attention/
    scheduler/
  distributed/
    tensor_parallel/
    data_parallel/
  benchmarks/
  tests/
  docs/
```

每个项目都必须留下：可运行代码、正确性测试、benchmark、profiler 结果和一页性能总结。

## 面试验收标准

完成路线后，应该能够：

- 解释 FlashAttention 如何避免物化 Attention Matrix。
- 推导 Softmax 和 Attention 的 backward。
- 说明 PagedAttention 解决的是哪一种显存问题。
- 区分 Prefill 和 Decode 的性能特征。
- 比较 GQA、MQA 和 MLA 的 KV Cache 差异。
- 使用 Nsight 定位 Kernel 瓶颈。
- 解释 Tensor Parallel 的通信量。
- 把一个 CUDA 算子迁移到另一种后端。
- 拿出 correctness、benchmark 和 profiling 结果。

段子里的“两小时写完一个算子”可以当作面试喜剧，不能当作训练计划。真正要形成的是一条闭环：能写、能证、能测、能解释、能迁移。

## Sources

- 用户提供的 Infra 面试段子及训练资料链接。
- [[writing/technical/ai/ai-infra/gpu|GPU 执行与性能]]
- [[writing/technical/ai/ai-infra/triton-kernel|Triton Kernel]]
- [[writing/technical/ai/ai-infra/ai-infra-llm-interface|LLM 推理接口与系统设计]]
