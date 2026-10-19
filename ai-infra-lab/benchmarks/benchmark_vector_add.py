#!/usr/bin/env python3
import argparse
import statistics

import torch

from kernels.vector_add import vector_add, vector_add_reference


def measure(operation, warmup: int, repetitions: int) -> list[float]:
    for _ in range(warmup):
        operation()
    torch.cuda.synchronize()

    samples_ms = []
    for _ in range(repetitions):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        operation()
        end.record()
        end.synchronize()
        samples_ms.append(start.elapsed_time(end))
    return samples_ms


def percentile(samples: list[float], fraction: float) -> float:
    ordered = sorted(samples)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def effective_bandwidth_gbps(numel: int, latency_ms: float) -> float:
    bytes_moved = 3 * numel * torch.tensor([], dtype=torch.float32).element_size()
    return bytes_moved / (latency_ms * 1e-3) / 1e9


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", type=int, nargs="+", default=[2**20, 2**24, 2**27])
    parser.add_argument("--warmup", type=int, default=25)
    parser.add_argument("--repetitions", type=int, default=100)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is required")

    device = torch.cuda.current_device()
    properties = torch.cuda.get_device_properties(device)
    print(f"GPU: {properties.name}")
    print(f"PyTorch: {torch.__version__} | CUDA runtime: {torch.version.cuda}")
    print(f"dtype: float32 | warmup: {args.warmup} | repetitions: {args.repetitions}")
    print()
    print(f"{'implementation':<16} {'elements':>12} {'p20 (ms)':>10} "
          f"{'median (ms)':>12} {'p80 (ms)':>10} {'GB/s':>10}")

    implementations = {
        "cuda_naive": vector_add,
        "torch.add": vector_add_reference,
    }
    for size in args.sizes:
        a = torch.randn(size, device=device, dtype=torch.float32)
        b = torch.randn_like(a)
        torch.testing.assert_close(vector_add(a, b), vector_add_reference(a, b))

        for name, implementation in implementations.items():
            samples = measure(
                lambda impl=implementation: impl(a, b),
                args.warmup,
                args.repetitions,
            )
            p20 = percentile(samples, 0.2)
            median = statistics.median(samples)
            p80 = percentile(samples, 0.8)
            bandwidth = effective_bandwidth_gbps(size, median)
            print(
                f"{name:<16} {size:>12,d} {p20:>10.4f} "
                f"{median:>12.4f} {p80:>10.4f} {bandwidth:>10.1f}"
            )


if __name__ == "__main__":
    main()

