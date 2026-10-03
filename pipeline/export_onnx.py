"""Export SEN2SR-Lite to ONNX so it can run in the browser (onnxruntime-web).

Two ops in the model have no ONNX equivalent, so they are rewritten as exact
linear algebra before tracing:
  * antialiased bilinear/bicubic *upsampling* -> separable resampling matrices
    computed from the original torch operator (bit-for-bit the same weights);
  * the FFT low-pass "hard constraint" -> real DFT matrix products:
        out = sr + Re(ifft2(M . fft2(lr_up - sr)))
    with M = ifftshift(mask). 12 real 512x512 matmuls per tile.

Usage: python export_onnx.py   -> docs/model/sen2sr_lite.onnx
"""
import math
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_sr  # noqa: E402
from sen2sr.models import tricks  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "model" / "sen2sr_lite.onnx"
_interp = F.interpolate


@lru_cache(maxsize=None)
def resample_matrix(n, N, mode):
    """(N, n) matrix U such that 1-D antialiased resampling of v is U @ v."""
    # width must be >1: the antialiased kernels misbehave on single-pixel axes
    basis = torch.eye(n, dtype=torch.float64).reshape(n, 1, n, 1).repeat(1, 1, 1, 4)
    out = _interp(basis, size=(N, 4), mode=mode, antialias=True, align_corners=False)
    return out[:, 0, :, 0].T.contiguous().float()          # (N, n)


def interp(x, size=None, scale_factor=None, mode="nearest", align_corners=None,
           recompute_scale_factor=None, antialias=False):
    if antialias and mode in ("bilinear", "bicubic"):
        h, w = int(x.shape[-2]), int(x.shape[-1])
        if size is None:
            sf = scale_factor if isinstance(scale_factor, (tuple, list)) else (scale_factor, scale_factor)
            size = (int(math.floor(h * sf[0])), int(math.floor(w * sf[1])))
        H, W = int(size[0]), int(size[1])
        if H >= h and W >= w:
            Uh, Uw = resample_matrix(h, H, mode), resample_matrix(w, W, mode)
            return torch.matmul(torch.matmul(Uh, x), Uw.T)
    return _interp(x, size=size, scale_factor=scale_factor, mode=mode, align_corners=align_corners,
                   recompute_scale_factor=recompute_scale_factor, antialias=antialias)


@lru_cache(maxsize=None)
def dft(n):
    k = torch.arange(n, dtype=torch.float64)
    ang = 2 * math.pi * torch.outer(k, k) / n
    return torch.cos(ang).float(), torch.sin(ang).float()


@lru_cache(maxsize=None)
def separable_filter(key, n):
    """If the mask is rank-1 (M = a b^T), return real (A, B) with
    Re ifft2(M . fft2(D)) == A @ D @ B.T  -> 2 matmuls instead of 12."""
    M = torch.fft.ifftshift(MASKS[key].double())
    U, s, Vh = torch.linalg.svd(M)
    if s[1] / s[0] > 1e-6:
        return None
    a, b = U[:, 0] * s[0].sqrt(), Vh[0] * s[0].sqrt()
    k = torch.arange(n, dtype=torch.float64)
    W = torch.exp(-2j * math.pi * torch.outer(k, k) / n)
    A = (W.conj() @ torch.diag(a.to(torch.complex128)) @ W) / n
    Bt = (W @ torch.diag(b.to(torch.complex128)) @ W.conj()) / n
    if A.imag.abs().max() > 1e-9 or Bt.imag.abs().max() > 1e-9:
        return None
    return A.real.float(), Bt.real.T.contiguous().float()


MASKS = {}


def hc_forward(self, lr, sr):
    bands = getattr(self, "bands", "all")
    lr_sel = lr if bands == "all" else lr[:, bands]
    lr_up = interp(lr_sel, size=(int(sr.shape[-2]), int(sr.shape[-1])), mode="bicubic", antialias=True)
    n = int(sr.shape[-1])
    D = lr_up - sr
    key = id(self)
    MASKS[key] = self.low_pass_mask.float().cpu()
    sep = separable_filter(key, n)
    if sep is not None:
        A, B = sep
        return sr + torch.matmul(torch.matmul(A, D), B.T)
    C, S = dft(n)
    M = torch.fft.ifftshift(self.low_pass_mask.float().cpu())     # constant
    P, Q = torch.matmul(C, D), torch.matmul(S, D)
    Fr = torch.matmul(P, C) - torch.matmul(Q, S)                  # Re fft2(D)
    Fi = -(torch.matmul(P, S) + torch.matmul(Q, C))               # Im fft2(D)
    Gr, Gi = M * Fr, M * Fi
    A = torch.matmul(C, Gr) - torch.matmul(S, Gi)
    B = torch.matmul(S, Gr) + torch.matmul(C, Gi)
    return sr + (torch.matmul(A, C) - torch.matmul(B, S)) / (n * n)


def main():
    torch.manual_seed(0)
    model = run_sr.load_model(torch.device("cpu"))
    X = torch.rand(1, 10, 128, 128) * 0.35
    with torch.no_grad():
        ref = model(X)

    F.interpolate = interp
    for name in dir(tricks):
        cls = getattr(tricks, name)
        if isinstance(cls, type) and issubclass(cls, torch.nn.Module) and name.startswith("HardConstraint"):
            cls.forward = hc_forward
    with torch.no_grad():
        mine = model(X)
    print("torch parity (patched vs original) max abs diff:", float((mine - ref).abs().max()))

    print("cached resamplers:", resample_matrix.cache_info().currsize, "dft sizes:", dft.cache_info().currsize,
          "separable masks:", sum(v is not None for v in [separable_filter(k, int(MASKS[k].shape[-1])) for k in MASKS]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model, X, str(OUT), opset_version=17, input_names=["x"], output_names=["y"],
                      dynamo=False, do_constant_folding=True)
    import onnxruntime as ort
    y = ort.InferenceSession(str(OUT)).run(None, {"x": X.numpy()})[0]
    print("onnx parity max abs diff:", float(np.abs(y - ref.numpy()).max()),
          f"size {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
