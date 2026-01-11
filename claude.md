# CLAUDE.md — UNS App Generator (Next.js Fullstack, Minimal Burden)

Goal: generate an end-to-end **UNS App Builder** with a modern UI (left sidebar modules + right content)
and a **minimal backend + persistence** that is easy for an LLM to implement and maintain.

Time/complexity constraint:
- Prefer the **simplest** correct solution.
- Use **scaffolding/CLI installers**. Do not hand-write framework boilerplate.

Tech (fixed):
- **Next.js (App Router) + TypeScript**
- **shadcn/ui + Tailwind**
- Charts: **recharts**
- Icons: **lucide-react**
- Persistence: **SQLite (single file) with `better-sqlite3`** (no ORM)

This repo should run locally on a home server and be easy to deploy.

---

## 1) Definition of Done (DoD)

You are done only when:

1) App runs:
- `cd web && npm run dev` works (or `npm run build && npm start` works)

2) UI works:
- Left sidebar shows **modules** inferred from the user request
- Right content renders each module page
- Analytics module shows **KPI cards + 2 chart types + filters**

3) Backend works:
- API routes respond:
  - `GET /api/modules` returns inferred modules
  - `GET /api/events` returns persisted events/logs
  - `POST /api/events` appends an event
  - `POST /api/actions` records an action request and returns an ack

4) Persistence works (minimal):
- Data survives a server restart (SQLite file persists)
- Reads/writes do not crash under normal use

---

## 2) Scaffold & Install (Hard Rule: use CLI)

From repo root:

### 2.1 Scaffold Next.js
```bash
npx create-next-app@latest web --ts --eslint --tailwind --app
cd web
