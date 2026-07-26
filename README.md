# Vaanaya

Clinician-supervised, multilingual pre-anesthetic documentation. The MVP keeps
every proposed PAC fact linked to the patient's exact words and prevents
sign-off while required information is missing or uncertain.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev:api
npm run dev:web
```

Open `http://localhost:3000`. The web app proxies `/api` to the Fastify service
on port 8787.

## Environment

Copy `.env.example` to `.env`. Never expose `SUPABASE_SECRET_KEY` in the web
application.

- `SARVAM_API_KEY`: server-side Sarvam speech, translation, and voice access
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SECRET_KEY`: server-only Supabase key
- `VITE_SUPABASE_URL`: browser-side project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: browser-safe project key
- `DATABASE_URL`: Supabase pooler URI for CLI migrations
- `USE_SUPABASE_STORE`: set `true` only for the final persistence-backed demo
- `TELEGRAM_BOT_TOKEN`: existing follow-up bot
- `WEB_ORIGIN`: deployed web origin for API CORS
- `VITE_API_URL`: deployed API origin

Apply the database migration after setting a reachable pooler URI:

```bash
supabase db push --db-url "$DATABASE_URL"
```

Seed or verify the idempotent synthetic judge record:

```bash
npm run seed:demo
```

Keep `USE_SUPABASE_STORE=false` while rehearsing. Set it to `true` for the
final run that should persist clinician edits and the immutable signed note.

## Quality gate

```bash
npm test
npm run typecheck
npm run build
```

This runs the application tests and all invariants over the deterministic
1,000-case clinical corpus in `test-cases/corpus`.

## Product boundary

Vaanaya drafts documentation. It does not diagnose, infer an unknown medicine,
assign ASA status, recommend an anesthetic plan, or issue medication/fasting
instructions. A clinician must resolve uncertainty and sign every final note.
