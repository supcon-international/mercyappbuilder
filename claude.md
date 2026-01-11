# claude.md — Manufacturing Web App (Pure Frontend + localStorage, Seeded Mock Data Only)
To avoid wasting time and tokens, prefer **installing and importing** proven frameworks and base components instead of generating large amounts of boilerplate code.

Build a manufacturing web app that looks **modern and “cool”**, uses **#B2ED1D** as the primary accent, and has a **right-side module navigation rail**. The app must be **data-driven with real logic** (not static UI), while remaining **pure frontend / single-process**: everything runs in the browser and persists to `localStorage`.

**Hard constraint:** all data is **mock/seeded**. **No real-time feeds, no live integrations, no external APIs, no device connections.**  
“Not static” means: the UI is driven by local data, user actions change state, changes are traceable via events, and KPIs are derived from stored aggregates.

---

## 1) Non-negotiables
- **Pure frontend + `localStorage`** only. No backend services, no external databases.
- **Left-side navigation** is mandatory (collapsible, icon-first).
- **Primary accent is #B2ED1D** for primary actions, active states, focus states, key highlights.
- **Logic must be real**: at least one closed loop of CRUD + state transitions + event trail + derived KPIs.

---

## 2) Data Source Policy (Mock Only)
- **Seeded mock data is the only source of truth** (written on first run).
- **No real-time**: no websockets/subscriptions/polling for external data.
- Optional: a **local demo “advance” action** (manual step) that appends a few mock events and updates aggregates.
  - This is **not** a live connection—just scripted local progression for demos.

---

## 3) Scope Boundaries
- Good for: single-machine demo, offline PoC, showroom display, product validation.
- Not for: multi-user collaboration, cross-device sync, compliance-grade audit, high-frequency telemetry storage.
- Storage rule: keep **master data + low-frequency aggregates + event summaries**. Never store high-rate raw signals.

---

## 4) Domain Logic Principles (Make it “feel real” with mock data)
### 4.1 Three data categories only: Master / Runtime / Event
- **Master**: sites, lines, machines, products (low change).
- **Runtime**: work orders, batches, current state snapshots (low/medium change).
- **Event**: state changes, alerts, user actions (traceability).

### 4.2 Small, explicit state machines
- Keep status sets small.
- All UI actions must follow **valid transitions**; invalid transitions are rejected with clear feedback.

### 4.3 Events are the truth
- Any meaningful change appends an event:
  - `ts, type, entityId, severity, message, payload (small)`
- Timelines and “what happened” views are derived from events (not scattered flags).

### 4.4 KPIs are derived from aggregates
- Compute KPIs only from stored low-frequency aggregates.
- Formulas must be simple and explainable.

---

## 5) localStorage Rules (Avoid jank and data chaos)
### 5.1 Use few stable keys (no per-record keys)
- `app:v1:db` — master + runtime tables in a single JSON document
- `app:v1:events` — event array (**must be bounded**)
- `app:schemaVersion` — schema version

### 5.2 Versioning and migrations are mandatory
- On startup, run `migrate(oldVersion -> latest)` before using data.
- Migrations must be idempotent and recoverable.

### 5.3 Performance + size constraints
- `localStorage` is synchronous: large/frequent writes will freeze UI.
- Rules:
  - **Event cap**: keep a hard maximum; drop oldest beyond the limit.
  - **Write throttling**: update in-memory immediately; persist in batched intervals (e.g., 100–500ms).
  - **Tiny payloads**: events must not store large JSON blobs.

---

## 6) Frontend Architecture Principles (Pure frontend still needs boundaries)
- **Domain layer**: state machines, event creation, KPI math, validation rules (centralized).
- **Store layer**: single unified in-memory state access pattern.
- **Persistence layer**: localStorage read/write, throttling, migrations, import/export.
- **UI layer**: consumes domain outputs only; **no direct localStorage writes inside components**.

---

## 7) UI Principles (Neon-modern, still usable)
- Right-side nav rail: fixed, collapsible; active state clearly highlighted with #B2ED1D.
- Dark surfaces + high contrast + clear focus rings (keyboard-friendly).
- Must include: loading / empty / error states.
- Motion: hover/press transitions, skeletons; can use flashy animation.

---

## 8) Anti-scope Rules (To keep engineering small)
Default out-of-scope unless explicitly replacing something else:
- Any real data integration or “live” connectivity
- Multi-user collaboration and conflict resolution
- Complex RBAC/permission matrices
- High-frequency telemetry ingestion and time-series querying
- Heavy scheduling optimization or large reporting systems

---

## 9) Definition of Done
- Right-side navigation + #B2ED1D theme consistently applied.
- At least one complete mock-data loop:
  - CRUD + state transitions + event timeline + KPI derived from aggregates.
- Export/Import/Reset works reliably; demo is repeatable and stable offline.

---

## 10) Output Requirements for Claude
- Implement the **smallest complete loop**; avoid over-architecture.
- Do not add any real-time or integration code paths.
- All rules belong in Domain; all persistence belongs in Persistence.
- Always preserve: **pure frontend + localStorage + seeded mock data only**, **right-side nav**, **#B2ED1D**, **real logic**.
