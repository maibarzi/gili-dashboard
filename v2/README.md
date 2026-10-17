# Gili Dashboard v2 (prototype)

Clickable prototype of the next dashboard: a client management view where the
salon owner controls what Gili sends. **Runs on invented demo data only.** It is
not connected to any salon, Google Sheet, Calendar, or WhatsApp, and sends
nothing. The production dashboard (`/index.html`) is untouched.

Run: `python3 -m http.server 8000` in the repo root, open http://localhost:8000/v2/

## Screens

| Route | Screen | Who |
|---|---|---|
| `#/termine` | Appointments, next 14 days, filter by stylist | all |
| `#/kundinnen` | Client list: last visit, status, next planned message, filters | all |
| `#/kundin/:id` | Client profile: stats, planned messages (skip/approve), per-client message settings, note, timeline | all (staff read-only) |
| `#/nachrichten/chats` | Chats with Gili, open questions first | all |
| `#/nachrichten/geplant` | Queue of automated messages for the next 7 days | all (approve/skip: owner) |
| `#/nachrichten/gesendet` | Sent automated messages with outcome | all |
| `#/chat/:id` | One chat, automated messages marked | all |
| `#/einnahmen` | Revenue + "what Gili did" (rebooked clients, bookings via chat) | owner |
| `#/einstellungen` | Approval mode, send window, intervals per service, reviews, templates, team | owner |

Demo accounts: Anna (owner of two salons, to show the salon switcher) and
Sophie (staff in one salon).

## Structure

```
v2/
  index.html, styles.css
  js/
    app.js            router, shell, navigation
    auth.js           roles and permissions (owner / staff)
    ui.js             formatting and shared UI pieces
    views/*.js        one file per screen: render(ctx) → html, mount(el, ctx) → events
    api/index.js      THE ONLY data entry point for views
    api/mock/         demo implementation of the API
      seed.js         invented data, shaped like the planned tables
      rules.js        who gets which message when (stand-in for the server-side view)
      templates.js    WhatsApp templates
      store.js        in-memory data + demo edits in localStorage
```

Views never touch data directly; they call `ctx.api.*`. Switching to the real
backend means writing `api/supabase/index.js` with the same functions and
changing one line in `api/index.js`.

## API → planned backend

| API function | Backend (planned, Postgres/Supabase) |
|---|---|
| `auth.*` | Supabase Auth (e-mail link) + `memberships (user_id, salon_id, role)` |
| `getSalon`, `updateSalon` | `salons` |
| `listStaff`, `listTeam` | `staff`, `memberships` + users |
| `listServices`, `updateService` | `services (name, price, duration_min, reinvite_weeks)` |
| `listAppointments` | `appointments`, synced from Google Calendar by n8n |
| `listClients`, `getClient` | `clients` + a `client_overview` view (last visit, visits, revenue, state) |
| `updateClient` | `clients` (invites_enabled, reviews_enabled, paused_until, do_not_contact, note) |
| `listConversations`, `getChat` | `conversations`, `messages` (written by n8n) |
| `listQueue` | `due_messages` view: the same rules n8n uses to send |
| `setQueueStatus` | `queue_decisions (message_key, action, user_id, at)` |
| `listSent` | `messages` where kind ≠ chat |
| `getStats` | SQL aggregate / view |
| `getSettings`, `updateSettings` | `automation_settings` (one row per salon) |
| `templates` | `message_templates` (with Meta template id) |

**Contacts and people.** A `contact` is one WhatsApp number; the automated
messages go there. A `person` (`clients` above) is someone booked from that
number, by name: a mother booking for her daughter is one contact with two
people, each with their own visits and reinvite date. Appointments belong to a
person. Rules that limit how often we write (min gap, one reminder) apply per
contact, so one number never gets several invitations at once: if several
people under one contact are due, they go into one message. The prototype
still shows one person per number; the import (`tools/import`) already groups
this way.

Every table carries `salon_id`; row level security limits each user to the
salons in their memberships. Staff gets read access only, enforced in the
database, not just hidden in the UI.

## Rules shown in the prototype (`api/mock/rules.js`)

Invitation to come back:
- not if: do-not-contact, open complaint in chat (handoff), future appointment,
  no marketing consent, invitations off for this client, paused
- due `reinvite_weeks` after the last visit (per service, or one value for all)
- at least `min_gap_days` after the previous automated message
- one reminder after `followup_days` if there was no reply, then stop
- only inside the send window (days + hours)

Review request: `delay_hours` after the appointment ends, once per appointment,
not for cancelled appointments or do-not-contact clients.

Approval mode `manual` (default): nothing is sent until the owner approves.
`auto`: everything is sent unless skipped.

## Not in the prototype yet

- Real login, real data, sending
- Owner replying to a chat from the dashboard
- Promotional campaigns (the 400 messages/year)
- Live refresh
