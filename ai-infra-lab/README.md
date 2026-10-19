# AI Infra Lab

Hands-on experiments for learning GPU kernels and LLM infrastructure.

## Experiment 01: CUDA Vector Add

The first experiment establishes the workflow used by later kernels:

1. implement a PyTorch reference;
2. implement a naive CUDA kernel exposed as a PyTorch custom extension;
3. verify correctness over normal and boundary shapes;
4. benchmark steady-state latency and effective memory bandwidth.

### Run

```bash
python -m unittest discover -s tests -v
python -m benchmarks.benchmark_vector_add
```

The first command that imports the extension compiles it. Build artifacts are
stored under `~/.cache/torch_extensions`, outside this repository.

To inspect the generated machine code for the local GPU, set
`TORCH_CUDA_ARCH_LIST` before running, for example:

```bash
TORCH_CUDA_ARCH_LIST=9.0 python -m unittest discover -s tests -v
```

See [the experiment notes](docs/01-vector-add.md) for the implementation and
measurement model.
