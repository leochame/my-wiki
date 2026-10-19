#include <c10/cuda/CUDAGuard.h>
#include <c10/cuda/CUDAException.h>
#include <torch/extension.h>

namespace {

constexpr int kThreadsPerBlock = 256;

__global__ void vector_add_kernel(
    const float* a,
    const float* b,
    float* output,
    int64_t count) {
  const int64_t index =
      static_cast<int64_t>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (index < count) {
    output[index] = a[index] + b[index];
  }
}

}  // namespace

torch::Tensor vector_add_cuda(torch::Tensor a, torch::Tensor b) {
  TORCH_CHECK(a.is_cuda(), "a must be a CUDA tensor");
  TORCH_CHECK(b.is_cuda(), "b must be a CUDA tensor");
  TORCH_CHECK(a.device() == b.device(), "a and b must be on the same device");
  TORCH_CHECK(a.scalar_type() == torch::kFloat32, "a must have dtype float32");
  TORCH_CHECK(b.scalar_type() == torch::kFloat32, "b must have dtype float32");
  TORCH_CHECK(a.sizes() == b.sizes(), "a and b must have the same shape");
  TORCH_CHECK(a.is_contiguous(), "a must be contiguous");
  TORCH_CHECK(b.is_contiguous(), "b must be contiguous");

  const c10::cuda::CUDAGuard device_guard(a.device());
  auto output = torch::empty_like(a);
  const int64_t count = a.numel();
  if (count == 0) {
    return output;
  }

  const int64_t blocks = (count + kThreadsPerBlock - 1) / kThreadsPerBlock;
  vector_add_kernel<<<blocks, kThreadsPerBlock>>>(
      a.data_ptr<float>(), b.data_ptr<float>(), output.data_ptr<float>(), count);
  C10_CUDA_KERNEL_LAUNCH_CHECK();
  return output;
}

