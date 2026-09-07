---
id: mmx_frontend_dev
version: 1.0.0
description: |
triggers:
  - frontend
  - web ui
  - css layout
  - responsive design
---

## Context
# Frontend Studio

Build complete, production-ready frontend pages by orchestrating 5 specialized capabilities: design engineering, motion systems, AI-generated assets, persuasive copy, and generative art.

## Invocation

```
/frontend-dev <request>
```

The user provides their request as natural language (e.g. "build a landing page for a music streaming app").

## Skill Structure

```
frontend-dev/
├── SKILL.md                      # Core skill (this file)
├── scripts/                      # Asset generation scripts
│   ├── minimax_tts.py            # Text-to-speech
│   ├── minimax_music.py          # Music generation
│   ├── minimax_video.py          # Video generation (async)
│   └── minimax_image.py          # Image generation
├── references/                   # Detailed guides (read as needed)
│   ├── minimax-cli-reference.md  # CLI flags quick reference
│   ├── asset-prompt-guide.md     # Asset prompt engineering rules
│   ├── minimax-tts-guide.md      # TTS usage & voices
│   ├── minimax-music-guide.md    # Music prompts & lyrics format
│   ├── minimax-video-guide.md    # Camera commands & models
│   ├── minimax-image-guide.md    # Ratios & batch generation
│   ├── minimax-voice-catalog.md  # All voice IDs
│   ├── motion-recipes.md         # Animation code snippets
│   ├── env-setup.md              # Environment setup
│   └── troubleshooting.md        # Common issues
├── templates/                    # Visual art templates
│   ├── viewer.html               # p5.js interactive art base
│   └── generator_template.js     # p5.js code reference
└── canvas-fonts/                 # Static art fonts (TTF + licenses)
```

## Project Structure

### Assets (Universal)

All frameworks use the same asset organization:

```
assets/
├── images/
│   ├── hero-landing-1710xxx.webp
│   ├── icon-feature-01.webp
│   └── bg-pattern.svg
├── videos/
│   ├── hero-bg-1710xxx.mp4
│   └── demo-preview.mp4
└── audio/
    ├── bgm-ambient-1710xxx.mp3
    └── tts-intro-1710xxx.mp3
```

**Asset naming:** `{type}-{descriptor}-{timestamp}.{ext}`

### By Framework

| Framework | Asset Location | Component Location |
|-----------|---------------|-------------------|
| **Pure HTML** | `./assets/` | N/A (inline or `./js/`) |
| **React/Next.js** | `public/assets/` | `src/components/` |
| **Vue/Nuxt** | `public/assets/` | `src/components/` |
| **Svelte/SvelteKit** | `static/assets/` | `src/lib/components/` |
| **Astro** | `public/assets/` | `src/components/` |

### Pure HTML

```
project/
├── index.html
├── assets/
│   ├── images/
│   ├── videos/
│   └── audio/
├── css/
│   └── styles.css
└── js/
    └── main.js           # Animations (GSAP/vanilla)
```

### React / Next.js

```
project/
├── public/assets/        # Static assets
├── src/
│   ├── components/
│   │   ├── ui/           # Button, Card, Input
│   │   ├── sections/     # Hero, Features, CTA
│   │   └── motion/       # RevealSection, StaggerGrid
│   ├── lib/
│   ├── styles/
│   └── app/              # Pages
└── package.json
```

### Vue / Nuxt

```
project/
├── public/assets/
├── src/                  # or root for Nuxt
│   ├── components/
│   │   ├── ui/
│   │   ├── sections/
│   │   └── motion/
│   ├── composables/      # Shared logic
│   ├── pages/
│   └── assets/           # Processed assets (optional)
└── package.json
```

### Astro

```
project/
├── public/assets/
├── src/
│   ├── components/       # .astro, .tsx, .vue, .svelte
│   ├── layouts/
│   ├── pages/
│   └── styles/
└── package.json
```

**Component naming:** PascalCase (`HeroSection.tsx`, `HeroSection.vue`, `HeroSection.astro`)

---

## Compliance

**All rules in this skill are mandatory. Violating any rule is a blocking error — fix before proceeding or delivering.**

---

## Workflow
### Phase 1: Design Architecture
1. Analyze the request — determine page type and context
2. Set design dials based on page type
3. Plan layout sections and identify asset needs

### Phase 2: Motion Architecture
1. Select animation tools per section (see Tool Selection Matrix)
2. Plan motion sequences following performance guardrails

### Phase 3: Asset Generation
Generate all image/video/audio assets using `scripts/`. NEVER use placeholder URLs (unsplash, picsum, placeholder.com, via.placeholder, placehold.co, etc.) or external URLs.

1. Parse asset requirements (type, style, spec, usage)
2. Craft optimized prompts, show to user, confirm before generating
3. Execute via scripts, save to project — do NOT proceed to Phase 5 until all assets are saved locally

### Phase 4: Copywriting & Content
Follow copywriting frameworks (AIDA, PAS, FAB) to craft all text content. Do NOT use "Lorem ipsum" — write real copy.

### Phase 5: Build UI
Scaffold the project and build each section following Design and Motion rules. Integrate generated assets and copy. All `<img>`, `<video>`, `<source>`, and CSS `background-image` MUST reference local assets from Phase 3.

### Phase 6: Quality Gates
Run final checklist (see Quality Gates section).

---

# 1. Design Engineering

## 1.1 Baseline Configuration

| Dial | Default | Range |
|------|---------|-------|
| DESIGN_VARIANCE | 8 | 1=Symmetry, 10=Asymmetric |
| MOTION_INTENSITY | 6 | 1=Static, 10=Cinematic |
| VISUAL_DENSITY | 4 | 1=Airy, 10=Packed |

Adapt dynamically based on user requests.

## 1.2 Architecture Conventions
- **DEPENDENCY VERIFICATION:** Check `package.json` before importing any library. Output install command if missing.
- **Framework:** React/Next.js. Default to Server Components. Interactive components must be isolated `"use client"` leaf components.
- **Styling:** Tailwind CSS. Check version in `package.json` — NEVER mix v3/v4 syntax.
- **ANTI-EMOJI POLICY:** NEVER use emojis anywhere. Use Phosphor or Radix icons only.
- **Viewport:** Use `min-h-[100dvh]` not `h-screen`. Use CSS Grid not flex percentage math.
- **Layout:** `max-w-[1400px] mx-auto` or `max-w-7xl`.

## 1.3 Design Rules
| Rule | Directive |
|------|-----------|
| Typography | Headlines: `text-4xl md:text-6xl tracking-tighter`. Body: `text-base leading-relaxed max-w-[65ch]`. **NEVER** use Inter — use Geist/Outfit/Satoshi. **NEVER** use Serif on dashboards. |
| Color | Max 1 accent, saturation < 80%. **NEVER** use AI purple/blue. Stick to one palette. |
| Layout | **NEVER** use centered heroes when VARIANCE > 4. Force split-screen or asymmetric layouts. |
| Cards | **NEVER** use generic cards when DENSITY > 7. Use `border-t`, `divide-y`, or spacing. |
| States | **ALWAYS** implement: Loading (skeleton), Empty, Error, Tactile feedback (`scale-[0.98]`). |
| Forms | Label above input. Error below. `gap-2` for input blocks. |

## 1.4 Anti-Slop Techniques

- **Liquid Glass:** `backdrop-blur` + `border-white/10` + `shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`
- **Magnetic Buttons:** Use `useMotionValue`/`useTransform` — never `useState` for continuous animations
- **Perpetual Motion:** When INTENSITY > 5, add infinite micro-animations (Pulse, Float, Shimmer)
- **Layout Transitions:** Use Framer `layout` and `layoutId` props
- **Stagger:** Use `staggerChildren` or CSS `animation-delay: calc(var(--index) * 100ms)`

## 1.5 Forbidden Patterns
| Category | Banned |
|----------|--------|
| Visual | Neon glows, pure black (#000), oversaturated accents, gradient text on headers, custom cursors |
| Typography | Inter font, oversized H1s, Serif on dashboards |
| Layout | 3-column equal card rows, floating elements with awkward gaps |
| Components | Default shadcn/ui without customization |
---
Source: `MiniMax-AI/skills` — MIT, (c) MiniMax-AI.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/frontend-dev/SKILL.md` from `MiniMax-AI/skills` with the `gitmcp` MCP.
