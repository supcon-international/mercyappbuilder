# claude.md — Manufacturing Web App
To avoid wasting time and tokens, prefer **installing and importing** proven frameworks and base components instead of generating large amounts of boilerplate code.
- MAKE SURE YOUR THE NPM RUN DEV WONT GIVE ME A DEFAULT LANDING PAGE OF VITE+REACT or A BLANK PAGE
## Framework & UI Baseline (Mandatory)
BE CONCISE: You MUST answer concisely with fewer than 2 lines of text (not including tool use or code generation), unless user asks for detail. After editing code, do not write a long explanation, just keep it as short as possible without emojis.

PLAN AHEAD

All UI elements must be fully interactive with working onClick handlers, state changes, and real data updates - no static mockups or placeholder buttons. Every feature module must implement complete CRUD operations (Create, Read, Update, Delete) with functional forms and data persistence.
- Use **Vite + React + TypeScript** as the project framework
- Use **TailwindCSS 4.x + shadcn/ui** for base UI components. Do not hand-roll foundational components.
- Prefer adding components via the **shadcn CLI** and importing them, rather than generating custom equivalents.

### TailwindCSS 4.x Configuration (CRITICAL - prevents style loss)
- Use `@tailwindcss/vite` plugin in vite.config.ts (NOT postcss):
```ts
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```
- In index.css, use NEW syntax:
```css
@import "tailwindcss";
@source "../src/**/*.{ts,tsx}";
@theme {
  --color-primary: #B2ED1D;
  --color-background: #0a0a0a;
}
```
- DO NOT use old `@tailwind base/components/utilities` syntax
- DO NOT use tailwind.config.js (Tailwind 4 uses CSS-based config)

When generating components, always use Tailwind utility classes. Ensure all primary colors use CSS variables. DO NOT create new .css files; keep all styles within the TSX files.
### Dependency-First Output (Mandatory)
- Start with **install commands** for Vite/Tailwind/shadcn and any minimal utilities.
- Prefer **small targeted patches** over dumping full files.
- Do not generate base components (Button, Dialog, Table, Toast, etc.). Use **shadcn/ui** components.


Build a manufacturing web app that looks **modern and “cool”**, uses **#B2ED1D** as the primary accent, and has a **right-side module navigation rail**. The app must be **real logic** (not static UI), while remaining **pure frontend / single-process**: everything runs in the browser and persists to `localStorage`.

**Hard constraint:** all data is **mock/seeded**. **No real-time feeds, no live integrations, no external APIs, no device connections.**  

---

## 4) Domain Logic Principles (Make it “feel real” with mock data)
### 4.1  data categories only: Master / Runtime / 
- **Master**: sites, lines, machines, products (low change).
- **Runtime**: work orders, batches, current state snapshots (low/medium change).

### 4.2 Small, explicit state machines
- Keep status sets small.
- All UI actions must follow **valid transitions**; invalid transitions are rejected with clear feedback.


---

### 5.2 Defensive Data Loading (CRITICAL - prevents runtime errors)
When loading from localStorage, ALWAYS merge with defaults to ensure data integrity:
```ts
const loadState = (): AppState => {
  const defaults = createInitialState()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Merge with defaults - ensures all arrays exist even if localStorage is incomplete
      return {
        ...defaults,
        ...parsed,
        equipment: Array.isArray(parsed.equipment) ? parsed.equipment : defaults.equipment,
        workOrders: Array.isArray(parsed.workOrders) ? parsed.workOrders : defaults.workOrders,
        events: Array.isArray(parsed.events) ? parsed.events : defaults.events,
      }
    }
  } catch (e) {
    console.error('Failed to load state:', e)
  }
  return defaults
}
```
**NEVER** return `JSON.parse(stored)` directly - old/corrupted data will cause `.filter()` crashes.


---

## 6) Frontend Architecture Principles (Pure frontend still needs boundaries)
- **Domain layer**: state machines, event creation, validation rules (centralized).
- **Store layer**: single unified in-memory state access pattern.
- **Persistence layer**: localStorage read/write, throttling,
- **UI layer**: consumes domain outputs only; **no direct localStorage writes inside components**.

---

## 7) UI Principles (Neon-modern, cool)
- Dark surfaces + high contrast + clear focus rings.
- Motion: hover/press transitions, skeletons; can use flashy animation.

---

## 8) Anti-scope Rules (To keep engineering small)
Default out-of-scope unless explicitly replacing something else:
- Multi-user collaboration and conflict resolution
- Complex RBAC/permission matrices
---

## 10) Output Requirements for Claude
- Implement the **smallest complete loop**; avoid over-architecture.
- Do not add any real-time or integration code paths.
- All rules belong in Domain; all persistence belongs in Persistence.
- Always preserve: **pure frontend + localStorage + seeded mock data only**, **right-side nav**, **#B2ED1D**, **real logic**.


## Definition of Done (Previewable)
- The app must be buildable and the UI should render correctly in the browser without extra manual steps.
- All required dependencies are installed via the documented commands, and the project starts cleanly on a fresh clone.
- Seeded mock data initializes on first run so the UI is immediately usable (no blank “dead” app).
- DO NOT LOSE CSS STYLE AND RENDER A PLAIN HTML, TRY TO PREVENT IT!

---

## Build Verification (REQUIRED)
After completing the project, you MUST run build verification:

```bash
npm run build
```

**Build must succeed with zero errors.** Common issues to avoid:
- ❌ `TS6133: 'xxx' is declared but never read` — Remove unused imports/variables
- ❌ `TS2307: Cannot find module` — Check import paths
- ❌ TypeScript strict mode errors — Fix type annotations

If build fails, fix ALL errors before considering the task complete. Do NOT leave TypeScript errors for later.

---

## Anti-Stuck Rules (CRITICAL)
Prevent infinite loops and stuck states:

### Command Execution
- **NEVER** run commands that wait for user input (e.g., interactive prompts)
- **NEVER** start dev servers (`npm run dev`, `vite`) — they block indefinitely
- **ALWAYS** use `--yes` or `-y` flags for npm/npx commands that may prompt
- Set reasonable timeouts; if a command takes >2 minutes, something is wrong

### Error Handling
- If same error occurs 3 times, **STOP** and report to user instead of infinite retry
- If `npm install` fails, check network/registry issues, don't just retry blindly
- If build fails with same error after fix attempt, re-analyze the root cause

### Progress Checkpoints
- After each major step (install, create files, build), verify success before proceeding
- Don't assume success — check exit codes and output
- If stuck, summarize what was attempted and ask user for guidance

### Forbidden Patterns
```bash
# ❌ NEVER DO THESE:
npm run dev          # Blocks forever
npx create-xxx       # May prompt for input
npm init             # Interactive
git commit -m ""     # Empty commit message hangs

# ✅ SAFE ALTERNATIVES:
npm run build        # Exits when done
npx --yes create-vite my-app --template react-ts  # Non-interactive
```

---

**设计系统是核心。**你不应该在组件里写自定义“硬编码样式”，而要使用设计系统，并通过设计 token 与组件变体实现美观。

优先修改 index.css 和 tailwind.config.ts 建立统一设计系统，而不是每个组件单独写样式。

给要用的组件创建 variants；shadcn 组件就是为了可定制。

关键：颜色/渐变/字体等必须用语义化 token，不要直接用 text-white/bg-black 这种硬编码类名。

注意暗色/亮色对比，避免白字白底或黑字黑底。

需要特殊效果时：先在设计系统里定义 token，再在组件里使用 token，而不是 inline hack。

颜色格式一致：index.css 用 HSL，tailwind.config.ts 也要匹配；不要 rgb 塞进 hsl()。

Tailwind CSS 4.x 样式防丢失 (必读)
安装
bashnpm install -D tailwindcss @tailwindcss/vite
vite.config.ts
tsimport { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
src/index.css
css@import "tailwindcss";

@theme {
  --color-primary: #B2ED1D;
  --color-background: #0a0a0a;
  --color-foreground: #fafafa;
  --color-card: #141414;
  --color-border: #262626;
  --color-muted: #a1a1a1;
}
src/main.tsx
tsximport './index.css'  // 必须第一行
❌ 禁止
@tailwind base/components/utilities (旧语法)
tailwind.config.js (Tailwind 4 不用)
postcss.config.js 配置 tailwind