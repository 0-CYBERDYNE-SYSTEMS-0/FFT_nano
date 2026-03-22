# FFT_nano HTML Experience — PLANNING DOCUMENT
**Project:** fft-nano-experience
**Location:** `~/fft_nano/fft-experience/`
**Type:** Single-file HTML technical showcase / whitepaper experience
**Author:** hermes (for scrim wiggins / FFT_nano)

---

## 1. RECONNAISSANCE SUMMARY — FFT_nano Architecture

### What FFT_nano Is
FFT_nano is a single-process Node.js host that runs an LLM agent (via `pi` / Pi coding agent) inside an isolated Docker container and routes chat I/O through Telegram and/or WhatsApp. It is the nerve center of the FarmFriend Terminal ecosystem — a farming operations platform with deep Home Assistant integration.

### Core Data Flow
```
Telegram / WhatsApp
      ↓
  SQLite (router_state, registered_groups)
      ↓
Host Router/Scheduler (src/index.ts — 219KB)
      ↓
Docker Container (pi-runner)
      ↓
Pi Agent (LLM: GPT-4o-mini, Claude, GLM-4.7, etc.)
      ↓
Response back to originating chat
```

### Key Architectural Layers

**1. Channel Ingestion & Routing (src/index.ts)**
- 219KB monolithic orchestrator
- Telegram bot polling + WhatsApp session management
- Admin command spec: `/gateway`, `/tasks`, `/coder`, `/freechat`
- Chat policy: main responds to all; non-main requires `@ASSISTANT_NAME` trigger
- Singleton lock prevents dual-instance conflicts

**2. Container Runtime (src/container-runtime.ts, container/runtime/)**
- Docker-default isolation with optional host runtime
- Additional mount security via `~/.config/fft_nano/mount-allowlist.json`
- Per-group Pi home at `data/pi/<group>/.pi/` → mounted to `/home/node/.pi`
- Container spawn and mount wiring, env passthrough, timeout management

**3. Pi Runner & Skills (src/pi-runner.ts, src/pi-skills.ts)**
- Pi JSON parser + stream parser for agent output
- Skills mirrored into containers at runtime:
  - Setup skills: `skills/setup/`
  - Runtime skills: `skills/runtime/`
  - User skills: `~/nano/skills/` (main workspace, merged on collision)
- Provider presets: OpenAI, LM Studio, Ollama, Anthropic, Gemini, Z.AI (GLM), OpenRouter

**4. Memory Protocol (src/memory-*.ts)**
- `MEMORY.md` as canonical per-group/global memory
- `SOUL.md` for identity/policy (stable)
- Memory search with BM25-style scoring
- Per-group memory paths, maintenance, retrieval gateways

**5. Task Scheduling (src/task-scheduler.ts, src/cron/)**
- Cron v2 adapters (timer-based scheduler service)
- Schedule types: cron | interval | once
- Context modes: group | isolated
- Delivery modes: chat | webhook | announce | none
- Wake modes: next-heartbeat | now

**6. Farm Integration (src/farm-*.ts)**
- Home Assistant discovery + entity mapping
- Farm state collector: HA entities → farm-state.json
- Farm action gateway: control irrigation, sensors, climate
- Dashboard companion repo: `FFT_demo_dash`
- Demo vs Production onboarding modes

**7. Web / TUI (src/web/control-center-server.ts, src/tui/)**
- WebSocket gateway protocol (src/tui/protocol.ts)
- Web Control Center: file browser, skills catalog, logs viewer, runtime status
- TUI client connects to gateway WebSocket, renders sessions/messages
- TUI startup sessions, theme engine

**8. Persistence (src/db.ts)**
- SQLite: router_state, registered_groups, scheduled_tasks, task_run_logs
- 18KB of schema and query logic

**9. Onboarding & Bootstrap (src/onboard-cli.ts, src/workspace-bootstrap.ts)**
- Guided onboarding wizard: risk gate → quickstart|advanced → local|remote
- Workspace seeding: AGENTS.md, SOUL.md, USER.md, IDENTITY.md, PRINCIPLES.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md
- Bootstrap gate: redirect tasks into onboarding interview until `ONBOARDING_COMPLETE`
- Profile system: `core` (default fresh) vs `farm` (farm-oriented)

---

## 2. DESIGN VISION — "THE NANOSPHERE"

### Concept
An immersive, single-file HTML experience that presents FFT_nano's architecture as a **living, breathing digital organism** — the NanoSphere. Every panel, animation, and data visualization is rooted in the actual FFT_nano codebase. This is not a marketing page. It is a **technical manifesto** — an overwhelming, high-density, maximum-stimulus experience that communicates the depth, elegance, and power of FFT_nano's architecture while being genuinely useful as documentation.

### Design Language
- **Theme:** Deep-space terminal noir. Black/navy void backgrounds, electric neon accents (FFT green `#39FF14`, signal cyan `#00F5FF`, warning amber `#FFB800`, alert red `#FF3366`). Inspired by oscilloscope displays, bioluminescent organisms, and cyberpunk HUDs.
- **Typography:** Monospace for data/code (JetBrains Mono via Google Fonts), clean sans for headings (Space Grotesk). High information density with clear hierarchy.
- **Motion:** Particle flows for data movement, pulse animations for live data, glitch effects on state transitions, smooth parallax scrolling sections.
- **Noise & Texture:** Subtle scanline overlay, grain texture on panels, CRT-style glow on key elements.
- **Sound:** Ambient drone synthesized via Web Audio API — subtle, not distracting. Optional mute.

### Color Palette
```
--void:        #050508
--deep:        #0a0b10
--panel:       #0d1117
--panel-edge:  #1a1f2e
--fft-green:   #39FF14
--cyan:        #00F5FF
--amber:       #FFB800
--alert:       #FF3366
--soft-white:  #e8e8f0
--dim:         #4a5568
--glow-green:  rgba(57,255,20,0.15)
--glow-cyan:   rgba(0,245,255,0.10)
```

---

## 3. INFORMATION ARCHITECTURE — SECTION BY SECTION

### S1: HERO / NANOSPHERE ORRERY
Full-viewport. Animated 3D-like particle system where particles flow between nodes representing each architectural component (Telegram node, Docker node, Pi node, SQLite node, Farm node). Nodes pulse with live data (message count, session count). Particle trails follow the actual FFT_nano data flow path. FFT_nano logo rendered as animated SVG with glitch effects.

### S2: SYSTEM ARCHITECTURE — THE LIVING DIAGRAM
Animated Excalidraw-style system diagram showing the complete Telegram→Host→Container→Pi→Response data flow. Each box is an architectural component from `src/`. Hover reveals the actual file path, line count, and a 2-line description. Lines animate with flowing particles to show data direction. Layer toggle: "show all files" vs "show modules only".

### S3: REAL-TIME METRICS DASHBOARD
Live-updating panel grid:
- Active sessions (gauge)
- Messages processed (counter with animation)
- Container status (Docker running/stopped indicator)
- Farm entities connected (HA discovery count)
- Scheduler next-run countdown
- Skills loaded count
- Memory docs indexed
Data is generated from mock state (architecture-accurate), animated with number-flip transitions.

### S4: THE DATA FLOW — STEP BY STEP
Vertical timeline/scroll-driven animation. As user scrolls, each stage of the FFT_nano pipeline activates:
1. **Telegram Inbound** — Message hits router, parsed, stored in SQLite
2. **Route Resolution** — Main vs group, trigger detection, policy enforcement
3. **Container Spawn** — Docker image pulled, mounts wired, env passthrough
4. **Pi Execution** — LLM called, stream parsed, tools executed
5. **Memory Merge** — Skills mirrored, memory retrieved, context assembled
6. **Response Delivery** — Formatted, sent back, logged
Each stage has an animated SVG diagram and links to the actual source file.

### S5: SKILLS CONSTELLATION
Interactive node graph showing FFT_nano's skill tree. Root nodes: Setup Skills / Runtime Skills. Branches expand to show actual skill names (from `skills/runtime/`, `skills/setup/`, `~/nano/skills/`). Hover shows skill description from SKILL.md. Nodes glow when hovered. Connection lines show skill dependency/override relationships.

### S6: MEMORY PROTOCOL VISUALIZER
Animated diagram of how MEMORY.md, SOUL.md, memory search, and session context flow together. Shows actual file paths. Interactive — clicking a memory region highlights its role in context assembly. Includes mock search demo with BM25-style scoring visualization.

### S7: FARM TOPOLOGY — HA INTEGRATION
If farm profile detected or as showcase: 3D-ish wireframe visualization of farm entities (sensors, irrigation, climate). Each entity pulses. Connecting lines show HA→FFT_nano communication. Real-time-style display showing entity states. This section is the most visually spectacular — it connects FFT_nano's real-world purpose (farm automation) to its digital architecture.

### S8: CRON SCHEDULER TIMELINE
Visual timeline of scheduled tasks (from `src/cron/`). Tasks shown as bars on a 24-hour radial clock. Color-coded by type (cron=green, interval=cyan, once=amber). Hover shows task details. Animated "current time" needle. Live task queue visualization.

### S9: NANOBANANA GALLERY — CAPABILITY SHOWCASE
Image generation panel using nanobabana (nano-banana-pro skill) generating custom FFT_nano-themed imagery:
- "FFT_nano agent consciousness visualization — bioluminescent neural network in FFT green"
- "Farm friend terminal architecture diagram — holographic HUD style"
- "Pi coding agent debug stream — terminal aesthetic with particle effects"
Images displayed with glitch-in animation. Each image caption includes the exact prompt used.

### S10: RESEARCH CONTEXT — THE WHITE PAPER
Collapsible technical whitepaper sections covering:
- **Isolation Model**: Docker vs host, mount security, allowlist
- **Multi-Agent Memory**: Per-group MEMORY.md, session isolation, context merging
- **Skill Sandboxing**: Skill mirror protocol, override precedence, setup vs runtime
- **Farm Integration**: HA discovery algorithm, entity mapping, action gateway
- **Scheduling Architecture**: Cron v2 design, wake modes, delivery guarantees
Each section has an Excalidraw-style inline SVG diagram and links to source.

### S11: EXCALIDRAW ARCHITECTURE DIAGRAMS
Full Excalidraw-drawn diagrams embedded as interactive SVGs:
- Complete system architecture (all src/ files as nodes)
- Container mount topology
- Memory retrieval pipeline
- Farm action request/response flow
- Skills mirror protocol sequence diagram
Diagrams are animated: elements fade in on scroll, connections draw themselves.

### S12: TECHNICAL FOOTPRINT
Data visualization showing FFT_nano's codebase stats:
- Files by module (bar chart)
- Lines of code per module (horizontal bar)
- File type distribution (donut chart)
- Skills count (setup / runtime / user)
- Test coverage visualization
Generated from actual repo scan via embedded JavaScript.

### S13: FOOTER / NAVIGATION
Minimal. Links to GitHub, documentation, and a live fft status badge (mock).

---

## 4. TECHNICAL IMPLEMENTATION PLAN

### Stack
- **Single HTML file** — no build step, no dependencies to install
- **WebGL Shader** (inline GLSL) — particle system for S1 Hero
- **Canvas API** — metrics gauges, timeline, constellation graphs
- **Chart.js** (CDN) — bar/donut charts for technical footprint
- **Web Audio API** — ambient drone synthesizer (3 lines of code)
- **Inline SVGs** — all Excalidraw diagrams drawn by hand as inline SVG
- **Intersection Observer API** — scroll-driven animations
- **CSS Custom Properties** — full theming system
- **Smooth Scroll** — section navigation

### File Structure
```
fft-experience/
├── index.html          # The entire experience — single file
└── TODO.md             # This document
```

### Key Implementation Notes
- All animations use `requestAnimationFrame` — no heavy libraries
- Particle system: ~200 particles, CPU-safe with spatial optimization
- Chart.js loaded from cdnjs CDN
- Fonts from Google Fonts (JetBrains Mono, Space Grotesk)
- All data is mock/derived from reconnaissance — no backend required
- Fully responsive (mobile gets simplified particle count)
- Optional ambient audio: starts muted, one-click unmute

---

## 5. NANOBANABA IMAGE GENERATION PLAN

Generate 4 images for the experience using the `nano-banana-pro` skill:

1. **Hero Visual**: "FFT_nano logo concept — bioluminescent neural network node in deep space, electric green and cyan on black void, cyberpunk HUD aesthetic, high detail, dramatic lighting"
2. **Farm Topology**: "Futuristic farm operation center — holographic wireframe irrigation system, sensor network nodes, cyan and amber on dark background, technical schematic aesthetic"
3. **Architecture Diagram**: "Abstract visualization of a multi-container software architecture — Telegram cloud connected to Docker containers, Pi agent brain in center, memory streams flowing like aurora, dark sci-fi aesthetic"
4. **Skills Constellation**: "Abstract star constellation — nodes connected by glowing threads of light, FFT green and cyan on deep navy, representing a distributed skills graph, magical realism style"

---

## 6. TODO LIST

### Phase 0: Setup & Reconnaissance (DONE)
- [x] Investigate ~/fft_nano repo structure
- [x] Read README.md, AGENTS.md, src/types.ts
- [x] Map src/ file tree and module responsibilities
- [x] Understand container runtime, skills, memory, farm, cron, web/TUI layers
- [x] Identify existing web/control-center structure
- [x] Write this planning document

### Phase 1: Whitepaper & Art Assets
- [ ] Generate 4 nanobanabana images for the experience
- [ ] Hand-draw 5 Excalidraw SVG diagrams (system arch, memory flow, skills tree, farm topology, cron timeline)
- [ ] Write all 13 section content blocks

### Phase 2: Core HTML Structure
- [ ] Set up HTML skeleton with CSS custom properties (color system)
- [ ] Implement Google Fonts + Chart.js CDN
- [ ] Build section scaffolding for all 13 sections
- [ ] Implement scroll navigation + Intersection Observer

### Phase 3: Animated Components
- [ ] Build S1 Hero — WebGL particle system with FFT_nano nodes
- [ ] Build S3 Metrics — Canvas gauges with number-flip animation
- [ ] Build S4 Data Flow — Scroll-driven timeline with SVG paths
- [ ] Build S5 Skills Constellation — Canvas node graph with hover
- [ ] Build S7 Farm Topology — Wireframe SVG with pulse animations
- [ ] Build S8 Cron Timeline — Radial clock with task bars

### Phase 4: Static Rich Content
- [ ] S2 Architecture diagram — interactive SVG with hover states
- [ ] S6 Memory protocol visualizer
- [ ] S9 Nanobanabana gallery — image grid with glitch-in
- [ ] S10 Whitepaper collapsible sections
- [ ] S12 Technical footprint — Chart.js visualizations

### Phase 5: Polish & Audio
- [ ] Scanline + grain overlays
- [ ] Ambient drone synthesizer (Web Audio API)
- [ ] Glitch transitions between sections
- [ ] Responsive design pass
- [ ] Performance optimization (particle count scaling)

### Phase 6: Testing & Delivery
- [ ] Test in browser — all animations run without errors
- [ ] Verify all external CDN resources load
- [ ] Final visual quality check
- [ ] Save session note about fft-experience project

---

## 7. APPROVAL GATE

This plan proposes building a single `fft-experience/index.html` file (~2000-3000 lines) that contains:

- 13 scroll-driven sections
- 1 WebGL particle hero
- 5+ hand-drawn Excalidraw SVGs
- 4 nanobanabana-generated images
- Canvas-based gauges, constellation, timeline
- Chart.js footprint visualization
- Web Audio ambient drone
- Full responsive design

**Estimated implementation time:** 6-10 focused coding blocks
**Dependencies:** Chart.js CDN, Google Fonts CDN, nanobanabana skill
**No build step required** — open index.html in browser

---

Do you want me to proceed with implementation, or would you like to refine any section, change the visual direction, add/remove sections, or adjust the scope?
