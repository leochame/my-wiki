#include <torch/extension.h>

torch::Tensor vector_add_cuda(torch::Tensor a, torch::Tensor b);

PYBIND11_MODULE(TORCH_EXTENSION_NAME, module) {
  module.def("forward", &vector_add_cuda, "Vector add forward (CUDA)");
}

