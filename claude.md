# claude.md — Manufacturing Web App
To avoid wasting time and tokens, prefer **installing and importing** proven frameworks and base components instead of generating large amounts of boilerplate code.
- MAKE SURE YOUR THE NPM RUN DEV WONT GIVE ME A DEFAULT LANDING PAGE OF VITE+REACT or A BLANK PAGE
## Framework & UI Baseline (Mandatory)


MAKE SURE ALL FUNCTIONS ARE INTEREACTIVE
- Use **Vite + React + TypeScript** as the project framework (no Next.js).


- Use **TailwindCSS + shadcn/ui** for base UI components. Do not hand-roll foundational components.
- Prefer adding components via the **shadcn CLI** and importing them, rather than generating custom equivalents.
When generating components, always use Tailwind utility classes. Ensure all primary colors use CSS variables defined in :root (e.g., var(--primary)). DO NOT create new .css files; keep all styles within the TSX files for maximum portability.
### Dependency-First Output (Mandatory)
- Start with **install commands** for Vite/Tailwind/shadcn and any minimal utilities.
- Prefer **small targeted patches** over dumping full files.
- Do not generate base components (Button, Dialog, Table, Toast, etc.). Use **shadcn/ui** components.


Build a manufacturing web app that looks **modern and “cool”**, uses **#B2ED1D** as the primary accent, and has a **right-side module navigation rail**. The app must be **data-driven with real logic** (not static UI), while remaining **pure frontend / single-process**: everything runs in the browser and persists to `localStorage`.

**Hard constraint:** all data is **mock/seeded**. **No real-time feeds, no live integrations, no external APIs, no device connections.**  
“Not static” means: the UI is driven by local data, user actions change state, changes are traceable via events, and KPIs are derived from stored aggregates.

---

## 1) Non-negotiables
- **Pure frontend + `localStorage`** only. No backend services, no external databases.
- **Left-side navigation** is mandatory (collapsible, icon-first).
- **Primary accent is #B2ED1D** for primary actions, active states, focus states, key highlights.
- **Logic must be real**: built in front end

---

## 3) Scope Boundaries
- Good for: single-machine demo, offline PoC, showroom display, product validation.

---

## 4) Domain Logic Principles (Make it “feel real” with mock data)
### 4.1 Three data categories only: Master / Runtime / Event
- **Master**: sites, lines, machines, products (low change).
- **Runtime**: work orders, batches, current state snapshots (low/medium change).
- **Event**: state changes, alerts, user actions (traceability).

### 4.2 Small, explicit state machines
- Keep status sets small.
- All UI actions must follow **valid transitions**; invalid transitions are rejected with clear feedback.


---

## 5) localStorage Rules (Avoid jank and data chaos)
### 5.1 Use few stable keys (no per-record keys)
- `app:v1:db` — master + runtime tables in a single JSON document


### 5.3 Performance + size constraints
- `localStorage` is synchronous: large/frequent writes will freeze UI.
- Rules:
  - **Write throttling**: update in-memory immediately; persist in batched intervals (e.g., 100–500ms).
  - **Tiny payloads**: events must not store large JSON blobs.

---

## 6) Frontend Architecture Principles (Pure frontend still needs boundaries)
- **Domain layer**: state machines, event creation, validation rules (centralized).
- **Store layer**: single unified in-memory state access pattern.
- **Persistence layer**: localStorage read/write, throttling,
- **UI layer**: consumes domain outputs only; **no direct localStorage writes inside components**.

---

## 7) UI Principles (Neon-modern, cool, still usable)
- left-side nav rail: fixed, collapsible; active state clearly highlighted with #B2ED1D.
- Dark surfaces + high contrast + clear focus rings (keyboard-friendly).
- Must include: loading / empty / error states.
- Motion: hover/press transitions, skeletons; can use flashy animation.

---

## 8) Anti-scope Rules (To keep engineering small)
Default out-of-scope unless explicitly replacing something else:
- Multi-user collaboration and conflict resolution
- Complex RBAC/permission matrices
- High-frequency telemetry ingestion and time-series querying
- Heavy scheduling optimization or large reporting systems
---

## 10) Output Requirements for Claude
- Implement the **smallest complete loop**; avoid over-architecture.
- Do not add any real-time or integration code paths.
- All rules belong in Domain; all persistence belongs in Persistence.
- Always preserve: **pure frontend + localStorage + seeded mock data only**, **right-side nav**, **#B2ED1D**, **real logic**.


## Definition of Done (Previewable)
- The app must be runnable locally with **`npm run dev`** and the UI should render correctly in the browser without extra manual steps.
- All required dependencies are installed via the documented commands, and the project starts cleanly on a fresh clone.
- Seeded mock data initializes on first run so the UI is immediately usable (no blank “dead” app).
- DO NOT LOSE CSS STYLE AND RENDER A PLAIN HTML, TRY TO PREVENT IT!
- MAKE SURE YOUR THE NPM RUN DEV WONT GIVE ME A DEFAULT LANDING PAGE OF VITE+REACT or A BLANK PAGE