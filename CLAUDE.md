# Gili Dashboard — development guide

Dashboard (PWA) for salon owners using Gili. First live client: **Yellow Beauty Studio (Parisa), Vienna**.
Production: https://gilidash.netlify.app

## ⚠️ Production safety — read first

Parisa uses the production site every day. Rules:

1. **Never commit directly to `main`.** Work on a feature branch, test, then merge.
2. **Production = whatever is deployed to the Netlify site `gilidash`.** Check in Netlify how it is deployed:
   - If the site is linked to GitHub → every merge to `main` goes live immediately.
   - If it is deployed manually (`netlify deploy --prod`, note `.netlify/` in `.gitignore`) → nothing goes live until someone runs that command.
   Either way: only merge / deploy after testing.
3. To preview a branch online without touching production, use `netlify deploy` (without `--prod`), which gives a separate preview URL. Or use Netlify branch deploys.
4. The dashboard only **reads** from Google Sheets/Calendar (GET requests). It never writes, so local testing cannot damage Parisa's data. It does, however, show her real customer data. For feature work prefer the demo salon's data (Florence Beauty Salon, see "Dev data" below).

## Architecture

```
WhatsApp ←→ n8n workflow + Gemini (the bot) ──writes──► Google Sheet (chat log) + Google Calendar (appointments)
                                                               │
                                          gili-dashboard reads them directly from the browser
```

The WhatsApp ↔ bot connection lives in **n8n** (maibarzilay.app.n8n.cloud), not in this repo.

## Files

- `index.html`: the whole app (CSS, HTML, JS) in one file, no build step.
- `manifest.json`: PWA manifest (installable on phone).
- `sw.js`: service worker file. **Currently not registered** in `index.html`, so it has no effect.

## Data sources (`CONFIG` in `index.html`)

- **Google Sheet** `SHEET_ID` / tab `SHEET_NAME`, columns A–G:
  `time | phone | userMsg | botResponse | status | customerName | service`.
  Status values: `BOOKED`, `HANDOFF_NEEDED`, `CANCELLED`, others shown as pending.
- **Google Calendar** `CALENDAR_ID`: event summary `"<service> – <name>"` (en dash), description contains `Phone: <digits>`.
- Calendar is the source of truth for "booked" status in Chats (matched by phone).
- Prices come from the hard-coded `PRICE_MAP` (matched by service name keywords).
- Data refreshes every 30s (`REFRESH_MS`).

## Dev data

Put the demo salon's Sheet and Calendar IDs in `CONFIG` **only on a local/dev branch**, never on `main`.
TODO: add a dev config switch (e.g. `?demo=1`) so the IDs don't have to be edited by hand.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000  (PIN is in CONFIG.PIN)
```

## UI conventions

- UI language: German (professional Viennese). No exclamation marks.
- Icons: Lucide (`data-lucide`), call `renderIcons()` after rendering. WhatsApp uses an inline SVG (`WA_ICON`), since Lucide has no brand icons.
- Contact buttons: use `contactButtons(phone)` (WhatsApp + phone). `waLink(phone)` normalizes to `wa.me/<international digits>`.
- Mobile first, max width 430px.

## Known issues / backlog

- **Security:** Google API key and PIN are visible in the client-side code. The PIN is checked in the browser only, and the Sheet/Calendar must be publicly readable for the API key to work, so customer phone numbers and chats are exposed to anyone with the link. Fix: move the data reads behind an n8n webhook or a Netlify Function with a server-side PIN/token.
- Config is hard-coded for one salon; multi-salon support would need per-salon config.
