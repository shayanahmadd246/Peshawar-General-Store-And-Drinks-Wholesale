# 5-Minute Hackathon Demo Script

Use seeded accounts and PostgreSQL. Prefer **text chat** if voice STT is quota-blocked.

## Prep (30s)

```powershell
cd D:\Projects\Peshawar-General-Store-And-Drinks-Wholesale
Copy-Item .env.example .env   # only if .env missing; then set DATABASE_URL + JWT_SECRET
npm install
npm run dev
```

Open http://localhost:3000

## Minute 1 — Shopkeeper + catalog

1. Gateway → **Shopkeeper / Client** → Sign In  
   - Phone: `03009876543` (password uses demo fallback / seed password)
2. Open **General Store & Drinks Catalog**  
3. Point out Cola carton stock, MOQ, price (live DB)

## Minute 2 — AI text chat → cart

1. Tab **AI Assistant & Drinks Chat**
2. Quick prompt: `Show me available cold drinks.`  
   - Or type: `Mujhe Pepsi ki 2 petiyan chahiye.`
3. Show suggested products / cart preview  
4. If Gemini is rate-limited, note the fallback banner — catalog tools still run
5. Open cart / checkout modal → show multi-wholesaler summary  
6. **Confirm** checkout (explicit) — say: “AI never auto-places orders”

## Minute 3 — Wholesaler approve

1. Logout → **Wholesaler**  
   - `wholesaler1@market.pk` / `password123`
2. Suborders → **Approve** the demo suborder  
3. Mention stock reservation (available = on_hand − reserved)

## Minute 4 — Dispatch + delivery

1. Logout → **Admin**  
   - `admin@market.pk` / `admin123`
2. Dispatch → assign `Gul Khan Logistics`
3. Logout → **Delivery**  
   - `delivery@market.pk` / `delivery123`
4. Advance shipment: Dispatched → In Transit → Delivered

## Minute 5 — Invoice + optional voice

1. As wholesaler or admin, record a **partial** payment on the new invoice  
2. As shopkeeper, open **Invoices & Balances** — show outstanding balance  
3. Optional voice (only if mic + quota allow):
   - Mic → speak → **Stop**
   - App **automatically** uploads, transcribes, and sends to the AI (WhatsApp-style)
   - Show the transcribed user bubble + assistant reply; cart may update, but **checkout still needs Confirm**
   - Optional: enable **Review mode** first if you want to preview/edit the transcript before send
   - If STT is empty or Gemini returns **429**: show the error → **type** the message manually (never invent a transcript)
   - Do **not** claim Pashto/Urdu STT unless a real spoken sample succeeded

## Fallback if anything fails

| Issue | Fallback |
|--------|----------|
| Gemini 429 (chat or STT) | Text chat + deterministic agents; commerce unchanged; manual text for voice |
| Voice empty/failed | Type transcript manually or use text chat |
| Mic denied | Text-only demo |
| Need API-only proof | `npm run demo:e2e` with server running |

## Do not say

- That Pashto/Urdu speech recognition is verified without a real sample  
- That an empty transcript box means successful transcription  
- That voice alone placed an order  
- That Review mode is required (it is optional; default is auto-send after Stop)
