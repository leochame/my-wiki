# AI Infra

This folder records the path from low-level GPU programming to LLM training and inference infrastructure.

## Articles

- [[writing/technical/ai/ai-infra/ai-infra-training-roadmap|AI infra 训练路线：从古法 GPU 编程到 Flash MLA]]
- [[writing/technical/ai/ai-infra/gpu|GPU 执行与性能]]
- [[writing/technical/ai/ai-infra/triton-kernel|Triton Kernel]]
- [[writing/technical/ai/ai-infra/ai-infra-llm-interface|LLM 推理接口与系统设计]]
- [[writing/technical/ai/ai-infra/ai-infra-glossary|AI Infra 术语]]

## Learning Principles

- Learn the hardware model before relying on high-level abstractions.
- Treat correctness, benchmarking, and profiling as part of implementation.
- Build the same idea through a reference implementation, a naive kernel, and an optimized kernel.
- Move from CUDA to Triton, CuTe, and NPU backends only after the underlying performance model is clear.
