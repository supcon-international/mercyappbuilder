# claude.md — Manufacturing Web App Principles

Build a lightweight manufacturing **web app** that is **modern**, **data-driven**, and **small in engineering scope**.

## Product Principles
- **Real > Fancy**: every screen must read/write real data and show derived values (not hardcoded UI).
- **Small surface area**: keep modules few, schemas small, flows simple.
- **Opinionated defaults**: choose one way to do things and stick to it (naming, status models, UI patterns).
- **Fast feedback loop**: local-first dev, one-command run, seed data always available.

## UI / UX Principles
- **Right-side navigation is non-negotiable**:
  - Primary module navigation lives on the **right rail**.
  - Collapsible; icon-first; active state is obvious.
- **Neon-but-readable**:
  - Primary accent **#B2ED1D** used for: primary actions, focus, active states, key highlights.
  - Dark surfaces + restrained secondary accents; avoid rainbow UI.
  - Keep contrast and focus rings strong (keyboard-friendly).
- **Modern “cool” feel**:
  - Minimal chrome, clean typography, generous spacing.
  - Subtle motion: hover/press transitions, skeleton loading; no heavy animation.
- **Information hierarchy first**:
  - Above-the-fold: status + next action + one or two KPIs.
  - Details progressively disclosed (side panel/drawer over new pages when possible).

## Data Principles
- **Model the factory, not the database**:
  - Separate *master data* (machines, lines, products) from *runtime* (orders, batches, events).
- **Events are the truth**:
  - Important state changes produce an event record (audit-lite).
  - UI derives “what happened” from the timeline, not scattered flags.
- **Aggregate by default**:
  - Store low-frequency aggregates (e.g., minute buckets) instead of high-frequency raw telemetry.
  - Compute KPIs from aggregates; keep formulas simple and transparent.
- **Deterministic state machines**:
  - A small set of statuses with explicit transitions; reject invalid transitions at the boundary.

## Backend / Storage Principles (Minimal)
- **One binary / one datastore** when possible (SQLite-based is preferred).
- **Boring APIs**:
  - CRUD + small derived endpoints (if needed); avoid custom frameworks.
- **Validation at the edge**:
  - Validate inputs at API boundary; validate responses in the client.
- **Idempotent writes**:
  - Updates should be safe to retry; use stable identifiers, avoid “append-only” chaos.

## Frontend Engineering Principles
- **Server state managed consistently**:
  - Cache, refetch, and mutations handled via a single query/mutation pattern.
- **Typed contracts**:
  - Shared schemas/types; parsing/validation at boundaries; fail fast with clear errors.
- **Progressive enhancement**:
  - Realtime is optional; polling is acceptable; don’t build complex streaming infra early.
- **Composable UI primitives**:
  - Use a consistent component set; avoid one-off styles per page.

## Scope Control Rules
- Start with **5–6 modules max**.
- Each module must fit the pattern: **list → detail → create/edit → event trail**.
- If a feature requires:
  - multi-service architecture, complex auth/RBAC, or high-frequency ingestion,
  - then it is **out of scope** unless it replaces something else.

## “Not Static” Requirement (How to satisfy cheaply)
- Always include:
  - CRUD on core entities
  - computed KPIs from stored aggregates
  - event timeline fed by real writes
- If no real plant integration exists:
  - use a **simulator** that generates plausible state + aggregates + events.
  - simulator must write through the same APIs/storage as the app.

## Quality Bar
- Responsive layout, accessible focus states, clear empty/loading/error states.
- Every action produces an observable outcome (UI update + event).
- Prefer simplicity and reliability over feature count.

## Output Expectations for Claude
- Do not over-design. Prefer smallest complete implementation.
- Provide runnable code and only the minimum dependencies.
- Preserve: **right-side nav + #B2ED1D neon theme + real data + lightweight backend**.
