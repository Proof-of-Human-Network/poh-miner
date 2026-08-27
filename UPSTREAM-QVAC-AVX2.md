# Upstream: win32-x64 inference addon has no CPU fallback below AVX2

**File at:** https://github.com/tetherto/qvac/issues
**Affects:** `@qvac/llm-llamacpp` 0.38.2 (via `@qvac/sdk` 0.16.0), `prebuilds/win32-x64`
**Symptom here:** DAI-Miner on Windows dies at first model load with
`STATUS_ILLEGAL_INSTRUCTION` (`0xC000001D`). Reported on a Xeon E5-2696 v2
(Ivy Bridge-EP: AVX, no AVX2, no FMA) with an RX 580.

## The asymmetry

`linux-x64` ships a thin loader plus 14 dlopen-able CPU backends and picks one
at runtime by ggml backend score:

```
qvac__llm-llamacpp.bare (12.7 MB loader)   FMA/AVX2/AVX512 instructions: 0
libqvac-ggml-cpu-sandybridge.so            vpmaddubsw:  486 x xmm    FMA/AVX2: 0
libqvac-ggml-cpu-ivybridge.so              vpmaddubsw:  486 x xmm    FMA/AVX2: 0
libqvac-ggml-cpu-haswell.so                vpmaddubsw: 2234 x ymm    FMA/AVX2: 3181
```

`win32-x64` ships a single 95 MB monolith with the CPU backend and Vulkan
statically linked, and no variants at all:

```
win32-x64/qvac__llm-llamacpp.bare          vpmaddubsw: 1951 x ymm, 0 x xmm
                                           vfmadd231ps 209, vpermd 67,
                                           vpbroadcastd 31, vpsravd 6
```

The `ymm` `vpmaddubsw` profile matches `haswell` and there are **zero** `xmm`
(AVX-only) fallbacks. Embedded source paths show a single compilation of
`ggml-cpu\quants.c`, `repack.cpp`, `ops.cpp` — one baseline, no
`GGML_BACKEND_DL` dispatch. So the first quantized dot product or load-time
weight repack executes `vfmadd231ps` / `vpermd` and the process dies.

## Why Vulkan doesn't rescue it

Vulkan **is** already compiled into the Windows binary (`ggml-vulkan`,
`GGML_DISABLE_VULKAN`, `Vulkan 1.2 required` are all present). It never gets a
chance: ggml registers and initializes the CPU backend unconditionally at
registry construction, before any GPU is consulted. Users with perfectly
capable GPUs are blocked by a code path they would never execute.

## Ask

Build `win32-x64` with `GGML_BACKEND_DL` + `GGML_CPU_ALL_VARIANTS`, i.e. the
same way `linux-x64` is already built. This fixes every pre-Haswell Windows
host in one option: Xeon E5 v1/v2 homelab servers, pre-Zen AMD, and the
Atom-line Celeron/Pentium mini-PCs (Goldmont/Tremont have no AVX at all) —
which is a large share of the always-on hardware this SDK gets deployed on.

## What we shipped meanwhile (v0.4.25)

Detection only, not a fix. `@qvac/sdk` already captures the worker exit status
and then labels it `RPCInitTimeoutError` ("Worker process exited with code N,
signal S before IPC connection was established"), so the true cause reaches the
host as an unlabelled timeout and users chase network problems. We decode the
status in `src/checker/utils/qvac-models.js` and latch the circuit breaker on
permanent faults.

Suggestion for the SDK: surface a typed error for a pre-handshake worker death
carrying `exitCode`/`signal`, rather than folding it into the timeout error.
