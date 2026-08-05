# PropMind

Multi-tenant real estate AI SaaS: an embeddable chat widget that qualifies
leads, an auto-viewing scheduler, a negotiation co-pilot, and a per-agency
admin dashboard — backed by a cloud SQLite (Turso) database.

## What's in the box

| Piece | Where | Purpose |
|---|---|---|
| GHOST widget | `widget.js` / `/widget` | Embeddable chat (Sarah) that qualifies visitors and scores leads 1–10 per agency |
| Auto-viewing scheduler | `/api/ghost/viewing-offer` | Hot leads (8+) get offered 3 viewing slots; reply 1/2/3 to confirm |
| CLOSER | `/closer.html` | Negotiation co-pilot for agents |
| Admin dashboard | `/admin.html` | Analytics, leads, properties, agencies, Smart Listing Paste |
| Notifications | `services/notifications.js` | New leads emailed/WhatsApped to the owning agency |

## Quick start (any machine)

```bash
npm install
cp .env.example .env        # then fill in ANTHROPIC_API_KEY etc.
npm start                   # → http://localhost:8080
```

Health check: `GET /health` returns `{ persistence: { environment, dbPath, propertyCount, leadCount } }`.

## Environment variables

All variables are documented in [`.env.example`](.env.example). The essentials:

- `ANTHROPIC_API_KEY` — **required**. Powers the chat.
- `ADMIN_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` — admin dashboard auth. `ADMIN_SECRET` must be a long random string; it is sent as the `x-admin-secret` header. If it is unset, every `/api/admin/*` route returns 401 (fail-closed).
- `TURSO_URL` + `TURSO_TOKEN` — **required for production persistence** (see below). Without them the app uses a local `propmind.db` file.
- `AGENT_EMAIL` + `EMAIL_PASSWORD` — email lead alerts. `EMAIL_PASSWORD` must be a **16-character Gmail app password**, not your Gmail password.
- `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` — alternative to Gmail.
- `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` — optional Meta Cloud API WhatsApp.
- `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` — per-IP rate limits on public endpoints.

## Database: local dev vs production

- **Local** (no env vars): file `propmind.db` in the project root. Seed runs only when the properties table is empty.
- **Production** (any host): set `TURSO_URL`/`TURSO_TOKEN`. Turso is a managed SQLite that survives redeploys, restarts, and horizontal moves — unlike a host's ephemeral or attached disk. Migrations run automatically on boot.

Create a free Turso DB:

```bash
npm i -g @libsql/turso   # or use the Turso dashboard
turso db create propmind
turso db show propmind --url            # → TURSO_URL
turso db tokens create propmind         # → TURSO_TOKEN
```

## Multi-tenancy

Each agency is a row in `agencies` (slug = `?agency=` in the widget URL).
Properties and leads carry `agency_id`; all reads and writes are scoped to the
resolved agency. The admin dashboard manages agencies and can filter
properties/leads per agency. Isolation guarantees:

- Public endpoints resolve the agency from `?agency=<slug>` (falling back to the default agency).
- Bulk property upload and "delete all" **require** an explicit `agency_id`/`agency` and refuse to operate globally.
- Deleting a lead, property, or confirming a viewing is ownership-checked against the agency.

## Embedding the widget on any website

One script tag, works on WordPress, Wix, Squarespace, Shopify, or a custom site:

```html
<script src="https://<your-host>/widget.js" data-agency="emaar-realty" defer></script>
```

The loader reads `data-agency`, derives its own base URL from the script tag, and
renders the whole UI inside an isolated iframe, so it can't clash with host CSS.
Omit `data-agency` to use the default agency. A host page can also control it
programmatically via `window.PropmindWidget.open()` / `.close()`.

## Deploying (any host)

Generic Node deploy — the repo has no host-specific code:

- **Build:** `npm install`
- **Start:** `npm start` (or `node server.js`)
- **Node:** 18.x (see `.node-version`)
- **Port:** `PORT` (default 8080)
- **Health check:** `/health`
- **Env:** set everything from `.env.example`, especially `ANTHROPIC_API_KEY`, `ADMIN_*`, and `TURSO_URL`/`TURSO_TOKEN`.

### Render (reference setup)

`render.yaml` is included. Render also auto-deploys on push to `main`, and the
`.github/workflows/deploy-render.yml` workflow can trigger it with the
`RENDER_API_KEY` / `RENDER_SERVICE_ID` repository secrets.

## Security notes

- All `/api/admin/*` routes require the `ADMIN_SECRET` header; fail-closed.
- Secrets are never committed: `.env*`, `propmind.db`, `logs/`, `.next/` are gitignored.
- The admin diagnostics endpoint only reports whether secrets are set, never their values.
- Public write/LLM endpoints are rate-limited per visitor IP.
- If an `EMAIL_PASSWORD` value ever leaks (e.g. printed in a log or chat), rotate it immediately and create a fresh app password.

## Local test

```bash
npm test
```

Requires a real `ANTHROPIC_API_KEY` for chat flows; otherwise use the admin API
smoke checks (`GET /api/admin/agencies` with the secret header).
