import unittest

import torch

from kernels.vector_add import vector_add, vector_add_reference


@unittest.skipUnless(torch.cuda.is_available(), "CUDA is required")
class VectorAddTest(unittest.TestCase):
    SHAPES = [
        (0,),
        (1,),
        (255,),
        (256,),
        (257,),
        (1025,),
        (17, 31),
        (2, 3, 5, 7),
        (1_000_003,),
    ]

    def test_matches_pytorch(self):
        torch.manual_seed(0)
        for shape in self.SHAPES:
            with self.subTest(shape=shape):
                a = torch.randn(shape, device="cuda", dtype=torch.float32)
                b = torch.randn(shape, device="cuda", dtype=torch.float32)

                actual = vector_add(a, b)
                expected = vector_add_reference(a, b)

                torch.testing.assert_close(actual, expected, rtol=0, atol=0)

    def test_rejects_mismatched_shapes(self):
        a = torch.randn(8, device="cuda")
        b = torch.randn(9, device="cuda")

        with self.assertRaisesRegex(RuntimeError, "same shape"):
            vector_add(a, b)

    def test_rejects_non_contiguous_input(self):
        a = torch.randn(4, 8, device="cuda").T
        b = torch.randn(8, 4, device="cuda")

        with self.assertRaisesRegex(RuntimeError, "contiguous"):
            vector_add(a, b)

    def test_rejects_non_float32_input(self):
        a = torch.ones(8, device="cuda", dtype=torch.float16)
        b = torch.ones_like(a)

        with self.assertRaisesRegex(RuntimeError, "float32"):
            vector_add(a, b)
