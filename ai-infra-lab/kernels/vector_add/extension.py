import os
from pathlib import Path

import torch
from torch.utils.cpp_extension import load


_SOURCE_DIR = Path(__file__).parent
_EXTENSION = None


def _load_extension():
    global _EXTENSION
    if _EXTENSION is None:
        os.environ.setdefault("TORCH_CUDA_ARCH_LIST", "9.0")
        _EXTENSION = load(
            name="vector_add_cuda_extension",
            sources=[
                str(_SOURCE_DIR / "vector_add.cpp"),
                str(_SOURCE_DIR / "vector_add_cuda.cu"),
            ],
            extra_cuda_cflags=["-O3"],
            verbose=os.environ.get("AI_INFRA_BUILD_VERBOSE") == "1",
        )
    return _EXTENSION


def vector_add_reference(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    return torch.add(a, b)


def vector_add(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    return _load_extension().forward(a, b)

