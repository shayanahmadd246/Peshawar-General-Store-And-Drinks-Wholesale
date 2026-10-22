# Peshawar General Store & Drinks Wholesale

Hackathon wholesale platform: PostgreSQL commerce, multi-wholesaler checkout, dispatch/invoices/payments, multilingual AI shopkeeper assistant (text + optional voice).

## Windows PowerShell startup

```powershell
cd D:\Projects\Peshawar-General-Store-And-Drinks-Wholesale

# 1) Environment (do not commit .env)
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env: set DATABASE_URL (postgres://postgres:YOUR_PASSWORD@localhost:5432/wholesale_db)
#           set JWT_SECRET to a long random string
# Optional: GEMINI_API_KEY for live AI/STT (commerce works without it)

# 2) Install & run
npm install
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**

PostgreSQL 17 must be running with database `wholesale_db`. Migrations and seed run on server start in development.

## Demo credentials (seed)

| Role | Login | Password |
|------|--------|----------|
| Shopkeeper | Phone `03009876543` | `password123` (demo fallback) |
| Wholesaler 1 | `wholesaler1@market.pk` | `password123` |
| Wholesaler 2 | `wholesaler2@market.pk` | `password123` |
| Admin | `admin@market.pk` | `admin123` |
| Delivery | `delivery@market.pk` | `delivery123` |

Seeded drinks include Cola carton `P401` (MOQ 2). See `DEMO_SCRIPT.md` for a 5-minute walkthrough.

## Supported features

- Auth + RBAC + tenant isolation (admin / wholesaler / client / delivery)
- Live catalog, persistent cart, confirmed multi-wholesaler checkout + idempotency
- Wholesaler approve/reject with stock reservation
- Admin dispatch assign → delivery status → invoice → partial payments
- AI text chat (Gemini when available; deterministic tool agents on quota/outage)
- WhatsApp-style voice: **Record → Stop → automatic transcription → AI response** (never auto-places orders)
- Optional **Review mode** to preview/edit the transcript before send
- On empty STT or Gemini **429** quota errors: show the error and use **manual text fallback** (never fabricate a transcript)
- Optional TTS play for English; Pashto/Urdu TTS not claimed as verified

## Verification commands

```powershell
npm run lint
npm test
npm run build

# With `npm run dev` already running in another terminal:
npm run smoke:ai
npm run smoke:voice
node scripts/api-auth-smoke.mjs
node scripts/api-commerce-smoke.mjs
node scripts/api-phase3-smoke.mjs
npm run demo:e2e
```

Live Gemini audio probing is **opt-in**: set `GEMINI_LIVE_AUDIO_TEST=1` only when quota allows.

## Secrets hygiene

- `.env` is gitignored via `.env*` (`.env.example` is the only env template allowed)
- Never commit `GEMINI_API_KEY`, `DATABASE_URL` passwords, or `JWT_SECRET`
- Voice uploads stay under `uploads/` (gitignored)

## Known limitations

- Gemini free-tier **429** → chat/STT fall back; type transcript or use text chat
- Empty STT result is **not** treated as successful transcription
- Pashto/Urdu speech recognition / TTS are **not** claimed without real speech verification
- Client sign-in UI is phone-based (seed password via demo fallback)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE` port 3000 | Stop other Node process using 3000, then `npm run dev` |
| DB connection failed | Check PostgreSQL service + `DATABASE_URL` in `.env` |
| AI “deterministic agents” note | Normal when Gemini missing/quota; ordering still works |
| Voice transcription failed | Type transcript manually; or use text chat |
| Cart MOQ errors | Use at least product MOQ (Cola = 2 cartons) |
