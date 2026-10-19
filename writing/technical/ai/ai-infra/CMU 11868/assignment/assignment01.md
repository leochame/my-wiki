# CMU 11868 — Assignment 1：CUDA Programming

## 当前作业做什么

Assignment 1 的目标是：在 MiniTorch 框架中实现一组高性能 CUDA 算子，并把 CUDA C++ kernel 通过 CUDA backend 接入 Python/Tensor 接口。

需要完成的算子是：

1. **Map**：对输入 tensor 的每个元素执行一元函数。
2. **Zip**：对两个输入 tensor 的对应元素执行二元函数。
3. **Reduce**：沿指定维度聚合元素。
4. **Matrix Multiplication**：实现矩阵乘法。
5. **Final Integration Test**：运行全部 CUDA 测试，确认各算子可以一起工作。

总分为 100 分：Map 15 分、Zip 25 分、Reduce 25 分、矩阵乘法 30 分、最终集成测试 5 分。

## 起始代码与目录

官方 starter repository：<https://github.com/llmsystem/llmsys_hw1>

作业页面：<https://llmsystem.github.io/llmsystemhomework/assignment_1/>

关键文件布局：

```text
llmsys_hw1/
├── minitorch/
│   └── cuda_kernel_ops.py   # Tensor backend 与 CUDA kernel 的 Python 集成
└── src/
    └── combine.cu            # Problems 1–4 的 CUDA kernel
```

代码中的待完成区域由以下标记包围：

```text
BEGIN HW1_1 ... END HW1_1   # Map
BEGIN HW1_2 ... END HW1_2   # Zip
BEGIN HW1_3 ... END HW1_3   # Reduce
BEGIN HW1_4 ... END HW1_4   # Matrix Multiplication
```

## 环境准备

作业需要可用的 NVIDIA GPU、CUDA toolkit 和 Python 环境。官方推荐使用 Python 3.12 的虚拟环境：

```bash
uv venv --python=3.12
source .venv/bin/activate
```

克隆并安装项目：

```bash
git clone https://github.com/llmsystem/llmsys_hw1.git
cd llmsys_hw1
uv pip install -r requirements.txt
uv pip install -Ue .
mkdir -p minitorch/cuda_kernels
```

检查 MiniTorch 是否安装成功：

```bash
python -c "import minitorch; print('Success: minitorch is installed correctly')" \
  2>/dev/null || echo "Error: Failed to import minitorch"
```

如果使用课程提供的 PSC 环境，需要在安装前申请 GPU 节点并加载对应 CUDA module；具体版本以课程环境为准。

## 完成步骤

### 1. Map kernel（15 分）

在 `src/combine.cu` 实现 `mapKernel`，每个 thread 处理一个输出元素：

- 使用 `blockIdx`、`blockDim`、`threadIdx` 计算全局 thread id。
- 对全局 id 做边界检查，避免越界访问。
- 按 tensor 的 shape 和 strides 计算多维索引对应的内存位置。

然后在 `minitorch/cuda_kernel_ops.py` 完成 Map 的 Python 集成。

编译并测试：

```bash
nvcc -o minitorch/cuda_kernels/combine.so \
  --shared src/combine.cu -Xcompiler -fPIC
python -m pytest -l -v -k "cuda_one_args"
```

### 2. Zip kernel（25 分）

在 `src/combine.cu` 实现 `zipKernel`，每个 thread 读取两个输入 tensor 的对应元素并写入输出：

- 处理两个输入的 strides。
- 确认 shape 相同或满足框架要求的 broadcast 规则。
- 做好输出边界检查。

在 `minitorch/cuda_kernel_ops.py` 实现 `CudaKernelOps.zip`。

```bash
nvcc -o minitorch/cuda_kernels/combine.so \
  --shared src/combine.cu -Xcompiler -fPIC
python -m pytest -l -v -k "cuda_two_args"
```

### 3. Reduce kernel（25 分）

在 `src/combine.cu` 实现 `reduceKernel`，沿 `reduce_dim` 聚合输入元素。需要注意：

- 输出中的一个元素对应被规约维度上的多个输入元素。
- 规约步长必须根据 `reduce_dim` 和 strides 计算。
- 先完成正确的基础版本，再考虑 shared memory 的树形并行规约优化。
- `ReduceSum`、`ReduceMultiply`、`ReduceMax` 的初始值和二元函数行为要符合框架接口。

在 `minitorch/cuda_kernel_ops.py` 实现 `CudaKernelOps.reduce`。

```bash
nvcc -o minitorch/cuda_kernels/combine.so \
  --shared src/combine.cu -Xcompiler -fPIC
python -m pytest -l -v -k "cuda_reduce"
```

### 4. Matrix multiplication kernel（30 分）

在 `src/combine.cu` 实现 `MatrixMultiplyKernel`：

- 基础版本可以让一个 thread 计算输出矩阵的一个元素。
- 使用全局索引映射出输出的 row 和 column。
- 沿共享维度累加乘积。
- 确保 row/column 不越界。
- 可选优化：使用 shared-memory tiling，减少 global memory 访问。

在 `minitorch/cuda_kernel_ops.py` 实现 `CudaKernelOps.matrix_multiply`。

```bash
nvcc -o minitorch/cuda_kernels/combine.so \
  --shared src/combine.cu -Xcompiler -fPIC
python -m pytest -l -v -k "cuda_matmul"
```

### 5. 最终集成测试（5 分）

所有 kernel 和 Python 集成完成后，重新编译并运行全部 CUDA 测试：

```bash
nvcc -o minitorch/cuda_kernels/combine.so \
  --shared src/combine.cu -Xcompiler -fPIC
python -m pytest -l -v -k "cuda"
```

每次修改 `src/combine.cu` 后都要重新执行 `nvcc` 编译，否则测试可能仍在使用旧的 `.so` 文件。

## 推荐实现顺序

```text
环境安装
  → Map kernel + Python 集成
  → Zip kernel + Python 集成
  → Reduce 基础正确性版本 + Python 集成
  → Matrix Multiplication 基础版本 + Python 集成
  → 全部 CUDA 测试
  → （可选）shared-memory 优化与性能分析
```

每个阶段都建议先通过对应的单项测试，再进入下一项。遇到非法内存访问时，优先检查 thread 边界、stride 计算、shared memory 访问和必要的 `__syncthreads()`。

## 提交

提交整个 `llmsys_hw1` 目录的 zip 文件到课程 Canvas。代码会自动编译，并使用 private test cases 评分。

## 本地进度

- [ ] 找到/克隆 `llmsys_hw1` starter code
- [ ] 配置 CUDA 与 Python 环境
- [ ] Map
- [ ] Zip
- [ ] Reduce
- [ ] Matrix Multiplication
- [ ] 全部 CUDA 测试通过
- [ ] 打包并提交

## Sources

- [Assignment 1: CUDA Programming](https://llmsystem.github.io/llmsystemhomework/assignment_1/)
- [官方 starter repository](https://github.com/llmsystem/llmsys_hw1)
