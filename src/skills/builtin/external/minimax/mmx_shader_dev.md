---
id: mmx_shader_dev
version: 1.0.0
description: Comprehensive GLSL shader techniques for creating stunning visual effects — ray marching, SDF modeling, fluid simulation, particle systems, procedural generation, lighting, post-processing, and more.
triggers:
  - shader
  - glsl
  - webgl
  - fragment shader
  - raymarching
---

## Context
# Shader Craft

A unified skill covering 36 GLSL shader techniques (ShaderToy-compatible) for real-time visual effects.

## Invocation

```
/shader-dev <request>
```

`$ARGUMENTS` contains the user's request (e.g. "create a raymarched SDF scene with soft shadows").

## Skill Structure

```
shader-dev/
├── SKILL.md                      # Core skill (this file)
├── techniques/                   # Implementation guides (read per routing table)
│   ├── ray-marching.md           # Sphere tracing with SDF
│   ├── sdf-3d.md                 # 3D signed distance functions
│   ├── lighting-model.md         # PBR, Phong, toon shading
│   ├── procedural-noise.md       # Perlin, Simplex, FBM
│   └── ...                       # 34 more technique files
└── reference/                    # Detailed guides (read as needed)
    ├── ray-marching.md           # Math derivations & advanced patterns
    ├── sdf-3d.md                 # Extended SDF theory
    ├── lighting-model.md         # Lighting math deep-dive
    ├── procedural-noise.md       # Noise function theory
    └── ...                       # 34 more reference files
```

## How to Use

1. Read the **Technique Routing Table** below to identify which technique(s) match the user's request
2. Read the relevant file(s) from `techniques/` — each file contains core principles, implementation steps, and complete code templates
3. If you need deeper understanding (math derivations, advanced patterns), follow the reference link at the bottom of each technique file to `reference/`
4. Apply the **WebGL2 Adaptation Rules** below when generating standalone HTML pages

## Technique Routing Table

| User wants to create... | Primary technique | Combine with |
|---|---|---|
| 3D objects / scenes from math | [ray-marching](techniques/ray-marching.md) + [sdf-3d](techniques/sdf-3d.md) | lighting-model, shadow-techniques |
| Complex 3D shapes (booleans, blends) | [csg-boolean-operations](techniques/csg-boolean-operations.md) | sdf-3d, ray-marching |
| Infinite repeating patterns in 3D | [domain-repetition](techniques/domain-repetition.md) | sdf-3d, ray-marching |
| Organic / warped shapes | [domain-warping](techniques/domain-warping.md) | procedural-noise |
| Fluid / smoke / ink effects | [fluid-simulation](techniques/fluid-simulation.md) | multipass-buffer |
| Particle effects (fire, sparks, snow) | [particle-system](techniques/particle-system.md) | procedural-noise, color-palette |
| Physically-based simulations | [simulation-physics](techniques/simulation-physics.md) | multipass-buffer |
| Game of Life / reaction-diffusion | [cellular-automata](techniques/cellular-automata.md) | multipass-buffer, color-palette |
| Ocean / water surface | [water-ocean](techniques/water-ocean.md) | atmospheric-scattering, lighting-model |
| Terrain / landscape | [terrain-rendering](techniques/terrain-rendering.md) | atmospheric-scattering, procedural-noise |
| Clouds / fog / volumetric fire | [volumetric-rendering](techniques/volumetric-rendering.md) | procedural-noise, atmospheric-scattering |
| Sky / sunset / atmosphere | [atmospheric-scattering](techniques/atmospheric-scattering.md) | volumetric-rendering |
| Realistic lighting (PBR, Phong) | [lighting-model](techniques/lighting-model.md) | shadow-techniques, ambient-occlusion |
| Shadows (soft / hard) | [shadow-techniques](techniques/shadow-techniques.md) | lighting-model |
| Ambient occlusion | [ambient-occlusion](techniques/ambient-occlusion.md) | lighting-model, normal-estimation |
| Path tracing / global illumination | [path-tracing-gi](techniques/path-tracing-gi.md) | analytic-ray-tracing, multipass-buffer |
| Precise ray-geometry intersections | [analytic-ray-tracing](techniques/analytic-ray-tracing.md) | lighting-model |
| Voxel worlds (Minecraft-style) | [voxel-rendering](techniques/voxel-rendering.md) | lighting-model, shadow-techniques |
| Noise / FBM textures | [procedural-noise](techniques/procedural-noise.md) | domain-warping |
| Tiled 2D patterns | [procedural-2d-pattern](techniques/procedural-2d-pattern.md) | polar-uv-manipulation |
| Voronoi / cell patterns | [voronoi-cellular-noise](techniques/voronoi-cellular-noise.md) | color-palette |
| Fractals (Mandelbrot, Julia, 3D) | [fractal-rendering](techniques/fractal-rendering.md) | color-palette, polar-uv-manipulation |
| Color grading / palettes | [color-palette](techniques/color-palette.md) | — |
| Bloom / tone mapping / glitch | [post-processing](techniques/post-processing.md) | multipass-buffer |
| Multi-pass ping-pong buffers | [multipass-buffer](techniques/multipass-buffer.md) | — |
| Texture / sampling techniques | [texture-sampling](techniques/texture-sampling.md) | — |
| Camera / matrix transforms | [matrix-transform](techniques/matrix-transform.md) | — |
| Surface normals | [normal-estimation](techniques/normal-estimation.md) | — |
| Polar coords / kaleidoscope | [polar-uv-manipulation](techniques/polar-uv-manipulation.md) | procedural-2d-pattern |
| 2D shapes / UI from SDF | [sdf-2d](techniques/sdf-2d.md) | color-palette |
| Procedural audio / music | [sound-synthesis](techniques/sound-synthesis.md) | — |
| SDF tricks / optimization | [sdf-tricks](techniques/sdf-tricks.md) | sdf-3d, ray-marching |
| Anti-aliased rendering | [anti-aliasing](techniques/anti-aliasing.md) | sdf-2d, post-processing |
| Depth of field / motion blur / lens effects | [camera-effects](techniques/camera-effects.md) | post-processing, multipass-buffer |
| Advanced texture mapping / no-tile textures | [texture-mapping-advanced](techniques/texture-mapping-advanced.md) | terrain-rendering, texture-sampling |
| WebGL2 shader errors / debugging | [webgl-pitfalls](techniques/webgl-pitfalls.md) | — |
---
Source: `MiniMax-AI/skills` — MIT, (c) MiniMax-AI.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/shader-dev/SKILL.md` from `MiniMax-AI/skills` with the `gitmcp` MCP.
