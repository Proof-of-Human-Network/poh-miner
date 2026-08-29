# Upstream issue for github.com/tetherto/qvac/issues

**Title:** `win32-x64: llm-llamacpp has no CPU fallback below AVX2 (linux-x64 ships 14 variants)`

---

## Summary

`@qvac/llm-llamacpp` ships `linux-x64` as a thin loader plus 14 dlopen-able
per-microarch CPU backends, selected at runtime by ggml backend score. It ships
`win32-x64` as a single statically-linked monolith built at an AVX2/FMA
baseline, with no AVX-only fallback and no runtime dispatch.

Result: every Windows host older than Haswell dies at first model load with
`STATUS_ILLEGAL_INSTRUCTION` (`0xC000001D`). The same hardware works on Linux.

We hit this downstream in DAI-Miner (Electron + `@qvac/sdk` 0.16.0). Reported by
a user on a Xeon E5-2696 v2 (Ivy Bridge-EP: AVX, no AVX2, no FMA) with an RX 580.

## Packaging asymmetry

`prebuilds/linux-x64/`

```
qvac__llm-llamacpp.bare (12.7 MB loader)   FMA/AVX2/AVX512 instructions: 0
libqvac-ggml-cpu-sandybridge.so            vpmaddubsw:  486 x xmm    FMA/AVX2: 0
libqvac-ggml-cpu-ivybridge.so              vpmaddubsw:  486 x xmm    FMA/AVX2: 0
libqvac-ggml-cpu-haswell.so                vpmaddubsw: 2234 x ymm    FMA/AVX2: 3181
+ 11 more variants (sse42, x64, piledriver, skylakex, icelake, zen4, …)
```

`prebuilds/win32-x64/`

```
qvac__llm-llamacpp.bare (95 MB monolith)   vpmaddubsw: 1951 x ymm, 0 x xmm
                                           vfmadd231ps 209, vfmadd213ps 66,
                                           vpermd 67, vpbroadcastd 31, vpsravd 6
(no CPU variant files at all)
```

The `ymm` `vpmaddubsw` profile matches `haswell`, and there are **zero** `xmm`
(AVX-only) fallbacks. Embedded source paths confirm a single compilation of the
CPU backend — `ggml-cpu\quants.c`, `ggml-cpu\repack.cpp`, `ggml-cpu\ops.cpp`
appear once each, i.e. no `GGML_BACKEND_DL` multi-variant build.

Build provenance leaked in the binary:
`C:\Users\actions-runner\vcpkg\buildtrees\qvac-fabric\src\v9840.0.0-f78517b95a.clean\ggml\src\ggml-cpu\repack.cpp`

Reproduce on any checkout:

```sh
objdump -d prebuilds/win32-x64/qvac__llm-llamacpp.bare | grep -c vfmadd231ps
objdump -d prebuilds/linux-x64/qvac__llm-llamacpp/libqvac-ggml-cpu-ivybridge.so | grep -c vfmadd231ps
```

## This is not a regression — it has never shipped

Checked the published file listings across the package's whole history:

| version | published | win32-x64 | linux-x64 |
|---|---|---|---|
| 0.1.0  | 2025-08-26 | 1 monolith | — |
| 0.31.2 | 2026-07-06 | 1 monolith | 14 variants |
| 0.38.2 | 2026-07-25 | 1 monolith | 14 variants |
| 0.47.0 | 2026-08-24 | 1 monolith | 14 variants |

So downstreams cannot fix this by upgrading.

## Vulkan does not rescue it

Vulkan **is** already compiled into the Windows binary — `ggml-vulkan`,
`GGML_DISABLE_VULKAN` and `Vulkan 1.2 required` are all present. It never gets a
chance: ggml registers and initializes the CPU backend unconditionally at
registry construction, before any GPU is consulted. Users with capable GPUs are
blocked by a code path they would never execute.

## Impact

Every pre-Haswell Windows host: Xeon E5 v1/v2 (very common in homelab servers),
pre-Zen AMD, and the entire Atom-line Celeron/Pentium range — Goldmont and
Tremont have no AVX at all. For an SDK aimed at always-on local inference, that
is a meaningful share of the deployed hardware.

## Ask

Build `win32-x64` with `GGML_BACKEND_DL` + `GGML_CPU_ALL_VARIANTS`, the same way
`linux-x64` is already built. One option, existing machinery, fixes the whole
tier at once.

## Secondary ask: surface the failure

When the bare worker dies before the RPC handshake, `@qvac/sdk` 0.16.0 captures
the exit status and then folds it into a generic `RPCInitTimeoutError`
(`node-rpc-client.js`, the `close` handler):

```
Worker process exited with code 3221225501, signal null before IPC connection was established
```

`3221225501` is `0xC000001D`, but the wrapper says "RPC initialization timed
out" — so every downstream user reads this as a network problem. Please expose a
typed error for a pre-handshake worker death carrying `exitCode`/`signal`,
rather than folding it into the timeout error.

We currently decode it ourselves downstream and latch our circuit breaker on
permanent faults, but every consumer will have to reinvent that.
