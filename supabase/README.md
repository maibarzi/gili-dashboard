# Database (Supabase)

The CRM tables live in the existing Supabase project that n8n already uses
(next to the bot memory tables such as `parisa_chat_histories`).

**Nothing in this folder has been run against Supabase yet.** Review first.

## Migrations (run in order)

| File | What it does |
|---|---|
| `0001_crm_schema.sql` | New tables: salons, staff, memberships, platform_admins, services, contacts, people, appointments, appointment_services, messages, automation_settings, message_templates, queue_decisions. Row level security on all of them. |
| `0002_lock_existing_tables.sql` | Turns on row level security for the existing tables (chat histories, leads, onboarding) so the public API key can't read them. **Check first** that no public form writes to them with the anon key. |
| `0003_seed_florence.sql` | The Florence demo salon, its price list, default automation settings (off) and draft message templates. |

To run: Supabase dashboard → SQL Editor → paste one file → Run. Each file is
a single transaction: it either applies completely or not at all.

## Model in short

- **contact** = one WhatsApp number (where messages go). **person** = someone
  who gets appointments; several people can share one contact, and a regular
  without WhatsApp can be a person with no contact.
- Every row has `salon_id`. Composite foreign keys make it impossible to link
  rows of two different salons.
- **n8n** connects as `postgres` and bypasses RLS: it writes appointments,
  messages, chat status, and contacts/people created by the bot.
- **Dashboard** users sign in (Supabase Auth). Members read their salon's
  rows. Owners may change only specific columns: people settings, consent and
  do-not-contact, services, automation settings, queue decisions, and add
  people/contacts by hand or by import. Staff read only.
- Automations are off by default for every salon.

## Tests

`supabase/tests/run.sh` applies all migrations to a throwaway local Postgres
(with a small stand-in for Supabase auth) and checks access between two
salons, owner vs staff, anonymous access and n8n access. Run it after every
change to a migration.
