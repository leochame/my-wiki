# Experiment 01: CUDA Vector Add

## Question

Can a one-thread-per-element CUDA kernel produce the same result as
`torch.add`, and what fraction of HBM bandwidth does it reach?

## Implementations

- Reference: `torch.add(a, b)`.
- Naive CUDA: one CUDA thread computes one output element.
- Block size: 256 threads.
- Supported input: same-shape, contiguous CUDA tensors with `float32` dtype.

The boundary check in the kernel is required because the number of elements
does not generally divide evenly by the block size.

## Correctness

The test matrix includes empty tensors, values around the 256-thread block
boundary, multidimensional tensors, and a large non-power-of-two tensor.
Results are compared exactly because both implementations perform one FP32
addition per element.

## Measurement

The benchmark performs warm-up calls before collecting samples. Each sample is
measured with CUDA Events so asynchronous kernel launch does not produce a
misleading CPU-side duration. It reports p20, median, and p80 latency.

Effective memory bandwidth assumes two FP32 reads and one FP32 write:

```text
bandwidth = 3 * num_elements * sizeof(float) / latency
```

This is an effective traffic model, not a direct hardware-counter measurement.

## Results

Environment:

- GPU: NVIDIA H100 80GB HBM3
- Driver: 590.48.01
- CUDA compiler: 12.8
- PyTorch: 2.13.0+cu130
- PyTorch CUDA runtime: 13.0
- Data type: FP32

Initial smoke benchmark (10 warm-up iterations, 30 measured iterations):

| Implementation | Elements | p20 (ms) | Median (ms) | p80 (ms) | Effective GB/s |
|---|---:|---:|---:|---:|---:|
| Naive CUDA | 1,048,576 | 0.0149 | 0.0153 | 0.0156 | 823.5 |
| `torch.add` | 1,048,576 | 0.0139 | 0.0143 | 0.0147 | 881.7 |
| Naive CUDA | 16,777,216 | 0.0803 | 0.0805 | 0.0808 | 2500.1 |
| `torch.add` | 16,777,216 | 0.0724 | 0.0730 | 0.0733 | 2758.2 |
| Naive CUDA | 134,217,728 | 0.5863 | 0.5865 | 0.5867 | 2746.0 |
| `torch.add` | 134,217,728 | 0.5263 | 0.5267 | 0.5276 | 3057.7 |

The largest input is well beyond the GPU cache capacity and is the most useful
of these three sizes for estimating steady-state HBM traffic. The naive kernel
reaches about 90% of the effective bandwidth reported for `torch.add` on that
input. These are baseline numbers, not a controlled final result; the full
default run uses 25 warm-up and 100 measured iterations.

## Next Optimization

Profile the naive kernel, then evaluate vectorized `float4` loads/stores. Keep
the naive implementation as the baseline rather than replacing it.
