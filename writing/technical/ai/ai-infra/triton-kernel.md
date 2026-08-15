 # Triton Kernel：从 CS336 Lecture 6 理解 GPU Kernel 编程

Stanford CS336 Lecture 6 从 benchmarking 和 profiling 开始，依次介绍 CUDA kernel、Triton kernel、`torch.compile`、fused softmax 和矩阵乘法。本篇聚焦其中的 Triton 编程模型，并以课程中的 GeLU 和 softmax 为例。

主要来源：

- [CS336 Spring 2025 Lecture 6 源码](https://github.com/stanford-cs336/spring2025-lectures/blob/main/lecture_06.py)
- [Triton 官方教程：Vector Addition](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html)
- [Triton 官方教程：Fused Softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html)

## 为什么需要自己写 Kernel

PyTorch 的一个高层操作最终会调用一个或多个 GPU kernel。已有的 PyTorch、cuBLAS 或 cuDNN 实现通常已经经过充分优化，但仍有一些情况需要 custom kernel：

- 将多个 operation 融合成一个 kernel，减少中间张量的 global memory 读写；
- 针对固定 shape、stride 或数据类型使用更合适的计算方式；
- 实现框架暂未提供的新 operation；
- 将矩阵乘法、归一化或 activation 等操作融合到同一个执行过程。

Custom kernel 不保证更快。CS336 强调，任何实现都需要先检查正确性，再通过 benchmark 比较端到端时间，并用 profiler 确认时间和数据传输发生在哪里。

## Triton 与 CUDA 的编程层级

CUDA kernel 通常从单个 thread 的工作开始描述；Triton kernel 则从一个 **program instance** 处理的一组数据开始描述。

```text
Triton launch grid
├── Program instance 0：处理一组元素
├── Program instance 1：处理下一组元素
└── ...
```

在 NVIDIA GPU 上，一个 Triton program instance 通常会被编译成类似 CUDA thread block / CTA 的执行任务，再由 GPU 调度到 SM。Program instance 内的向量操作会由 Triton 编译器映射到具体 thread、warp 和执行指令。

| 对比项 | CUDA | Triton |
| --- | --- | --- |
| 主要编程单位 | Thread | Program instance 与数据 block |
| 数据索引 | `blockIdx`、`threadIdx` | `tl.program_id`、`tl.arange` |
| 访存合并 | 开发者显式组织 thread 地址 | 编译器根据 block operation 生成访问 |
| Shared memory 使用 | 开发者显式声明和同步 | 编译器负责较多低层管理 |
| Warp 数量 | 由 block threads 自动形成 | 可通过 `num_warps` 等 meta-parameter 调整 |
| 跨 SM 的工作数量 | Grid / block 配置 | Triton launch grid |

CS336 将这种差异概括为“CUDA operates on threads, Triton operates on blocks”。这里的 block 指一个 program instance 处理的**数据块**，不能直接理解成固定数量的 CUDA thread。

### Program instance 不是单个 Thread

Triton 官方 Vector Addition 教程中，`BLOCK_SIZE` 的定义是“每个 program 处理的元素数量”。例如：

```text
输入长度：256
BLOCK_SIZE：64

Program 0：元素   0～63
Program 1：元素  64～127
Program 2：元素 128～191
Program 3：元素 192～255
```

因此：

- `BLOCK_SIZE=1024` 表示一个 program instance 描述 1024 个元素的计算；
- 它不表示一定创建 1024 个 CUDA thread；
- 实际使用多少 thread / warp 由编译结果和 `num_warps` 等配置决定；
- 一个硬件 thread 也可能处理多个元素，这类优化通常称为 **thread coarsening**。

CS336 GeLU 代码中把 `block_size` 注释为 `Number of threads`，适合作为课程中的简化理解；从 Triton 官方编程模型看，更准确的含义是“每个 program instance 处理的元素数量”。

## CS336 GeLU Kernel

GeLU 是逐元素 operation，每个输出只依赖相同位置的输入，因此可以将一维向量切成多个数据 block，让不同 program instance 独立处理。

### Python Wrapper：确定 Grid

```python
def triton_gelu(x: torch.Tensor):
    assert x.is_cuda
    assert x.is_contiguous()

    y = torch.empty_like(x)
    num_elements = x.numel()
    block_size = 1024
    num_programs = triton.cdiv(num_elements, block_size)

    triton_gelu_kernel[(num_programs,)](
        x, y, num_elements, BLOCK_SIZE=block_size
    )
    return y
```

Wrapper 负责：

1. 检查输入位于 GPU 且内存连续；
2. 分配输出 tensor；
3. 用 `triton.cdiv` 计算需要多少个 program instance；
4. 通过 `kernel[grid](...)` 启动 Triton kernel。

`triton.cdiv(a, b)` 表示向上取整除法。假设 `num_elements=2500`、`BLOCK_SIZE=1024`：

```text
num_programs = ceil(2500 / 1024) = 3
```

三个 program instance 分别处理从 `0`、`1024`、`2048` 开始的数据区域。

### Kernel：Load、Compute、Store

下面保留 CS336 的近似 GeLU 计算方式：

```python
@triton.jit
def triton_gelu_kernel(
    x_ptr,
    y_ptr,
    num_elements,
    BLOCK_SIZE: tl.constexpr,
):
    pid = tl.program_id(axis=0)
    block_start = pid * BLOCK_SIZE
    offsets = block_start + tl.arange(0, BLOCK_SIZE)
    mask = offsets < num_elements

    x = tl.load(x_ptr + offsets, mask=mask)

    a = 0.79788456 * (x + 0.044715 * x * x * x)
    exp = tl.exp(2 * a)
    tanh = (exp - 1) / (exp + 1)
    y = 0.5 * x * (1 + tanh)

    tl.store(y_ptr + offsets, y, mask=mask)
```

`@triton.jit` 表示该函数由 Triton JIT compiler 编译为 GPU kernel。`BLOCK_SIZE: tl.constexpr` 表示 `BLOCK_SIZE` 是编译期常量，编译器可以用它确定 block tensor 的 shape 并进行专门优化。

### `tl.program_id`：当前 Program 的编号

```python
pid = tl.program_id(axis=0)
```

Triton launch grid 最多可以有三个 axis。这里使用一维 grid，因此 `axis=0`。如果 grid 是 `(3,)`，三个 program instance 读取到的 `pid` 分别是 `0`、`1`、`2`。

### `tl.arange`：生成一组连续 Offset

```python
block_start = pid * BLOCK_SIZE
offsets = block_start + tl.arange(0, BLOCK_SIZE)
```

`tl.arange(0, BLOCK_SIZE)` 生成 `[0, BLOCK_SIZE)` 范围内的连续值。对于 `BLOCK_SIZE=1024`：

```text
Program 0 offsets：   0～1023
Program 1 offsets：1024～2047
Program 2 offsets：2048～3071
```

Triton 源码中的 `offsets` 是一个 block tensor，不是 Python list，也不是某个 CUDA thread 的单一索引。编译器会把这些元素级 operation 映射到 GPU 的 thread 和 vector instruction。

### Mask：保护边界访问

最后一个 program 的部分 offset 可能超出 tensor 长度：

```python
mask = offsets < num_elements
x = tl.load(x_ptr + offsets, mask=mask)
tl.store(y_ptr + offsets, y, mask=mask)
```

在 `num_elements=2500` 的例子中，Program 2 描述 `2048～3071`，但只有 `2048～2499` 有效。Mask 让 `tl.load` 和 `tl.store` 忽略超出范围的位置，避免越界访问。

### 为什么整个 GeLU 写在一个 Kernel 中

从读取 `x` 到写入 `y` 之间的中间值 `a`、`exp` 和 `tanh` 都属于同一个 program instance。它们不需要作为完整 tensor 写回 global memory。编译器可以让这些中间值保留在 register 或其他片上资源中。

```text
Global memory 读取 x
        ↓
在同一个 kernel 中完成 GeLU
        ↓
Global memory 写入 y
```

这就是 Triton 适合编写 fused pointwise kernel 的原因之一：开发者直接描述一个数据 block 上的完整计算，而不是组合多个需要物化中间 tensor 的独立 kernel。

## 从 Pointwise 到 Row-wise：Fused Softmax

GeLU 中的每个输出只依赖一个输入元素。Softmax 不同：一行中的每个输出都依赖该行的最大值和指数和，因此需要在一组元素上进行 reduction。

CS336 先用多个 PyTorch operation 表达 row-wise softmax：

```python
x_max = x.max(dim=1)[0]
x = x - x_max[:, None]
numerator = torch.exp(x)
denominator = numerator.sum(dim=1)
y = numerator / denominator[:, None]
```

如果这些步骤分别物化中间 tensor，课程统计得到 `5MN + M` 次逻辑读取和 `3MN + 2M` 次逻辑写入。Fused softmax 的目标是让一个 program instance 在片上完成一行的归一化，只从 global memory 读取一次输入行并写回一次输出行。

### 一个 Program Instance 处理一行

CS336 的简化实现为每一行启动一个 program instance：

```python
def triton_softmax(x: torch.Tensor):
    m, n = x.shape
    y = torch.empty_like(x)
    block_size = triton.next_power_of_2(n)

    triton_softmax_kernel[(m,)](
        x,
        y,
        x.stride(0),
        y.stride(0),
        n,
        BLOCK_SIZE=block_size,
    )
    return y
```

Grid size 是 `m`，因此每个 program instance 负责一行。`BLOCK_SIZE` 取不小于列数 `n` 的最小 2 的幂，以满足 block tensor shape 的要求。

```python
@triton.jit
def triton_softmax_kernel(
    x_ptr,
    y_ptr,
    x_row_stride,
    y_row_stride,
    num_cols,
    BLOCK_SIZE: tl.constexpr,
):
    row_idx = tl.program_id(axis=0)
    col_offsets = tl.arange(0, BLOCK_SIZE)
    mask = col_offsets < num_cols

    x_ptrs = x_ptr + row_idx * x_row_stride + col_offsets
    row = tl.load(x_ptrs, mask=mask, other=-float("inf"))

    row = row - tl.max(row, axis=0)
    numerator = tl.exp(row)
    denominator = tl.sum(numerator, axis=0)
    output = numerator / denominator

    y_ptrs = y_ptr + row_idx * y_row_stride + col_offsets
    tl.store(y_ptrs, output, mask=mask)
```

这里有三个关键点：

1. `row_idx * x_row_stride` 定位当前行，`col_offsets` 定位该行中的列；
2. 超出 `num_cols` 的位置由 mask 屏蔽，`tl.load(..., other=-inf)` 保证 padding 不影响 `tl.max`；
3. `tl.max` 和 `tl.sum` 是 block tensor 上的 reduction，由编译器映射为具体的 warp 和共享资源操作。

Triton 官方 Fused Softmax 教程指出，这种方案适用于一行能够放入 GPU SRAM 的矩阵。当前官方教程还使用 persistent program 让一个 program instance 循环处理多行；CS336 的“一行一个 program”版本更适合先理解基本的数据划分和 fusion。

## Triton 编译器负责什么

CS336 对 CUDA 与 Triton 的分工做了简化比较：

| 工作 | CUDA | Triton |
| --- | --- | --- |
| 组织 global memory coalescing | 开发者主要负责 | 编译器根据 block access pattern 处理更多细节 |
| Shared memory 管理 | 开发者显式声明、加载和同步 | 编译器负责更多分配与调度 |
| SM 内部的 thread / warp 安排 | 开发者显式设计 block | 编译器从 block operation 生成 |
| 跨 SM 的工作量 | 开发者设置 Grid | 开发者设置 Triton launch grid |

“自动”不表示开发者不需要考虑硬件。开发者仍然需要决定：

- 一个 program instance 处理多少元素；
- 数据按一维、二维还是三维 grid 划分；
- memory access 是否连续；
- `num_warps`、tile shape 和其他 meta-parameter；
- 单个 program 使用多少 register 和 shared memory。

这些选择会影响 coalescing、occupancy、数据复用和 program instance 的数量。

## 从 Triton 到 PTX

Triton kernel 会被编译为目标 GPU 的低层指令。在 NVIDIA GPU 上，可以检查生成的 PTX 或 SASS，确认源代码最终如何映射到硬件。

CS336 检查 GeLU PTX 时关注：

- `ld.global` / `st.global`：global memory 的读取和写入；
- `%ctaid.x`：CTA / block 索引；
- `%tid.x`：硬件 thread 索引；
- `%f*`、`%r*`：浮点和整数 register；
- 一个 thread 是否处理多个元素。

课程中的特定 GeLU 编译结果显示一个 thread 同时处理 8 个元素，这是 compiler thread coarsening 的结果，不是所有 Triton kernel 的固定规则。不同 Triton 版本、GPU、shape 和 meta-parameter 都可能生成不同 PTX。

## 正确 Benchmark Triton Kernel

CS336 将 benchmark 和 profile 分开：benchmark 回答“整体需要多长时间”，profile 回答“时间花在哪里”。测试 custom kernel 时至少需要以下步骤。

### 1. 先检查正确性

将 Triton 输出与 PyTorch reference implementation 比较，并覆盖：

- 规则和不规则 shape；
- 不是 `BLOCK_SIZE` 整数倍的长度；
- 不同 dtype；
- 不同 stride；
- 允许的数值误差。

Mask 错误通常只在边界 shape 中出现，因此不能只测试整齐的 2 的幂尺寸。

### 2. 排除首次编译成本

**Warm-up（预热）**是在正式计时前先执行若干次待测操作，目的是让一次性初始化在计时前完成。对 Triton kernel 来说，第一次调用可能包含：

- Triton JIT compilation，以及 PTX / 目标 GPU 代码的生成和加载；
- CUDA context、runtime 和 stream 的初始化；
- PyTorch caching allocator、library handle 和相关 cache 的初始化；
- GPU 频率和执行状态从空闲进入持续运行状态。

这些时间不属于 kernel 重复执行时的 steady-state latency，因此常规性能 benchmark 会先 warm-up。如果目标是测量首次请求或 cold-start latency，则不应排除这些成本。

Triton 会针对 dtype 和 `BLOCK_SIZE` 等 compile-time meta-parameter 生成 specialization；shape 变化也可能通过不同的 meta-parameter 触发新编译。因此，每种待测配置都应单独 warm-up。

### 3. 处理 GPU 异步执行

Kernel launch 对 host 通常是异步的。使用普通 CPU timer 时，需要在计时边界调用 `torch.cuda.synchronize()`；也可以使用 `triton.testing.do_bench`、CUDA Event 或 PyTorch benchmark 工具。

```python
for _ in range(num_warmups):
    run()

torch.cuda.synchronize()

start = time.time()
run()
torch.cuda.synchronize()
elapsed = time.time() - start
```

### 4. 比较对应的实现

至少比较：

- PyTorch eager implementation；
- `torch.compile` 生成的 implementation；
- custom Triton kernel；
- 已有的优化 library kernel（如果存在）。

性能取决于 shape、dtype、GPU 和 library version。某个尺寸更快，不代表所有输入都更快。

## 常见误区

| 误区 | 更准确的理解 |
| --- | --- |
| `BLOCK_SIZE` 就是 CUDA thread 数 | 它首先表示每个 program instance 描述的元素数量 |
| Triton 完全不需要理解 GPU | Grid、tile、warp、register、shared memory 仍会影响性能 |
| Triton kernel 一定比 PyTorch 快 | 已有 library kernel 可能更成熟，需要实际 benchmark |
| Mask 只影响性能 | 错误 mask 会产生越界访问或错误结果 |
| Python 函数调用就是同步完成 | GPU kernel launch 通常对 host 异步 |
| 只看耗时就能定位问题 | 还需要 profiler 和生成代码确认瓶颈 |

## 什么时候适合使用 Triton

比较适合：

- 多个 pointwise operation 的 fusion；
- row-wise softmax、normalization 等可以按行或 tile 划分的操作；
- matmul 与 activation、bias、quantization 等 epilogue fusion；
- shape 或数据布局固定，通用实现无法充分利用硬件的场景。

不应直接重写已有高质量实现。对于标准 GEMM、convolution 等 operation，应先比较 cuBLAS、cuDNN、PyTorch 和 `torch.compile` 的结果。Custom Triton kernel 的价值通常来自特定 workload 的 fusion、数据布局或计算约束。

## 完整执行关系

```text
Python wrapper
    │ 计算 Grid 和 meta-parameter
    ▼
Triton launch grid
    │ 产生多个 program instance
    ▼
Program instance
    │ 描述一个数据 block 上的 load / compute / store
    ▼
Triton compiler
    │ 生成 thread、warp、memory 和 instruction 映射
    ▼
PTX / machine code
    │ 由 GPU 调度到 SM
    ▼
执行并写回结果
```

开发者负责数据如何分块、启动多少 program instance，以及使用哪些 meta-parameter；编译器负责把 block-level operation 转换为目标 GPU 的具体执行方式。

## 参考资料

- [Stanford CS336 Spring 2025 — Lecture 6 source](https://github.com/stanford-cs336/spring2025-lectures/blob/main/lecture_06.py)
- [Triton Documentation — Vector Addition](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html)
- [Triton Documentation — Fused Softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html)
- [Triton Documentation — Matrix Multiplication](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html)
- [Triton API — `program_id`](https://triton-lang.org/main/python-api/generated/triton.language.program_id.html)
- [Triton API — `arange`](https://triton-lang.org/main/python-api/generated/triton.language.arange.html)
- [NVIDIA PTX ISA](https://docs.nvidia.com/cuda/parallel-thread-execution/)
