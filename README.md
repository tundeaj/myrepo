# Webinarflix

A live webinar, course, and community streaming platform for Nigeria, Ghana, and
Francophone West Africa. This repository implements the **Webinarflix Master Build
Prompt v2.0**, adapted from its original Greta.ai + NoCodeBackend target to a
standard, self-hosted full-stack app (see [Adaptation notes](#adaptation-notes) below).

## What's built in this pass

| Prompt | Scope | Status |
|---|---|---|
| **01-C** | Full database schema — all ~70 tables, enums, indexes, seed data | ✅ Built |
| **02** | Admin shell (sidebar/topbar) + Dashboard (setup checklist, stat tiles, chart, tables) | ✅ Built |
| 03 | Add/Edit Session | 🔲 Not built — placeholder page |
| 04 | Course Builder | 🔲 Not built — placeholder page |
| 05 | Media Library | 🔲 Not built — placeholder page |
| 06 | Instructor Portal | 🔲 Not built — placeholder page |
| 07 | Settings & Modules | 🔲 Not built — placeholder page |
| 08 | Homepage Row Builder + Cache | 🔲 Not built — placeholder page |
| 09 | Public Homepage | 🔲 Not built |
| 10 | AI / integration Netlify functions | 🔲 Not built |

Every sidebar destination not built yet renders a designed empty state (icon,
heading, explanation, "Back to Dashboard") instead of a blank page or a 404 — see
`web/src/pages/PlaceholderPage.tsx`.

## Stack

- **Database**: PostgreSQL 16, schema managed by **Prisma**.
- **API**: Node.js + Express + TypeScript, JWT auth, Zod validation.
- **Web**: React 18 + Vite + TypeScript + Tailwind CSS + Recharts, React Router.

This is a deliberate substitution for the source prompt's **Greta.ai + NoCodeBackend
(NCB)** target — neither is available as a tool in this environment. See
[Adaptation notes](#adaptation-notes).

## Getting started

### Prerequisites
- Node.js 20+
- PostgreSQL 16 running locally (or point `DATABASE_URL` at any Postgres instance)

### 1. Install
```bash
npm install   # installs both workspaces (server, web)
```

### 2. Configure the database
```bash
createdb webinarflix   # or: psql -c "CREATE DATABASE webinarflix;"
cp server/.env.example server/.env
# edit server/.env if your Postgres credentials differ from the default
```

### 3. Migrate + seed
```bash
npm run db:migrate   # generates prisma/migrations/ from schema.prisma and applies them
npm run db:seed      # reference/config data + a super_admin login + light demo data
```

`server/prisma/migrations/` and the root `package-lock.json` are intentionally not
committed — both are fully regenerated from `schema.prisma` / `package.json` by the
commands above, and were too large to push through this environment's file-content
API. `npm run db:migrate` creates the migration on first run.

The seed creates:
- **Login**: `admin@webinarflix.dev` / `ChangeMe123!` (role `super_admin`)
- Reference data called out by every `SEED` block in the schema (speaker types, image
  variants, policies, CMS pages, settings, modules, setup steps, footer links)
- A light demo dataset (7 sessions, 40 demo viewers, 12 subscriptions) so the
  dashboard isn't a wall of zeros on first run

### 4. Run
```bash
npm run dev:server   # http://localhost:4000
npm run dev:web      # http://localhost:5173 (proxies /api to :4000)
```

Open `http://localhost:5173`, sign in with the seeded admin account.

## Adaptation notes

The source document targets tools this session doesn't have: Greta.ai (a no-code
builder) and NoCodeBackend (a REST-first no-code database, "NCB" in the prompt).
Decisions made to translate it into a real, runnable codebase:

- **NCB → Postgres + Prisma.** NCB never declares foreign-key constraints — every
  cross-table reference in the source spec is a plain indexed integer column (e.g.
  `content_id INT NOT NULL`). The Prisma schema keeps that shape deliberately: no
  Prisma `@relation`s, just indexed `Int` columns, so the schema stays a direct,
  auditable transcription of the prompt rather than an invented relational model.
- **"NCB-native RLS; never Greta built-in auth"** (standing decision) → implemented
  as JWT auth issued by our own API, with role-based middleware
  (`server/src/middleware/auth.ts`). Row-level scoping (e.g. an instructor only
  seeing their own content) is a service-layer concern for Prompt 06, not yet built.
- **Prompt 10 integrations** (Anthropic, Paystack, Bunny Stream, ImageKit, calendar
  OAuth) need real accounts/keys nobody has supplied yet. `server/.env.example`
  lists every variable from the spec; nothing calls them yet since Prompts 03–10
  aren't built. When they are, wire them behind an adapter/service layer that reads
  these env vars, exactly as Prompt 10 specifies.
- **`t('key')` i18n helper**: backed by the real `ui_translations` table via a public
  `GET /api/i18n` endpoint (`web/src/i18n/I18nProvider.tsx`), with a readable
  fallback (key → Title Case) if a key hasn't been seeded yet — so missing copy is
  never a blank string.

## Security (TEST CHECKLIST — implemented so far)

- `password_hash` never leaves the API (`serializeUser`)
- `stream_key` never leaves the API on `content_items` (`serializeContentItem`) or
  `restream_targets` (`serializeRestreamTarget`)
- `account_number` masked to last 4 digits, `paystack_recipient_code` reduced to a
  boolean (`serializeSpeaker`)
- `is_secret` settings return only a boolean `is_set`, never the value
  (`serializeSetting`)
- All server errors funnel through one handler that logs a correlation ID
  server-side and returns plain English to the client — never a raw DB/framework
  error (`server/src/lib/errors.ts`)

Everything above is enforced at the serializer layer, not by remembering to omit a
field per-route — new routes get this for free by using the shared serializers.

## Repo layout

```
server/               Express + Prisma API
  prisma/schema.prisma   the full PROMPT 01-C schema
  prisma/seed.ts         reference data + demo dataset
  src/routes/            auth, dashboard, notifications, i18n
  src/lib/                prisma client, JWT, serializers, error handling
web/                  React admin console
  src/layout/            Sidebar, Topbar, AdminLayout, nav config
  src/pages/              Dashboard, Login, PlaceholderPage
  src/components/         StatusBadge, EmptyState, ErrorState, Skeleton, SetupChecklist, StatTile
  src/i18n/               I18nProvider / useTranslation
  src/lib/                api client, AuthContext, formatting helpers
```

## Next steps

Continue with Prompt 03 (Add/Edit Session) next — it's the first screen that writes
to `content_items`, and Prompts 04–08 build on it. See the master prompt document
for the full prompt text and the `SEQUENCING` table for dependency order.
