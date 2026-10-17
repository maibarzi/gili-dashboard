# History import (dry run)

Reads a salon's Google Calendar export (`.ics`) and chat log sheet (`.csv`) and
reports what a one-time import into the new database would produce: clients,
appointments, chat messages, and everything that needs a decision first
(events without phone, unknown service names, one number with several names,
rows from another salon's bot).

It only reads the two files and writes to `--out`. Nothing is sent or stored
anywhere else.

```bash
node tools/import/dry-run.mjs \
  --ics calendar.ics --csv chats.csv \
  --services tools/import/services.florence.json \
  --salon Florence --out /tmp/import-florence
```

Then, to load it into the database (tables from `supabase/migrations`):

```bash
node tools/import/to-sql.mjs --data /tmp/import-florence/data.json \
  --salon-slug florence-demo --out /tmp/import-florence/import.sql
```

Paste `import.sql` into the Supabase SQL editor. It is one transaction and
can be run again safely: existing contacts, people, appointments and messages
are skipped. Chat rows that greet as another salon are left out. Test it
locally first with `supabase/tests/run.sh /tmp/import-florence/import.sql`.

- Calendar: Google Calendar → Settings → the salon calendar → Export.
- Sheet: File → Download → CSV.
- `services.<salon>.json`: price list with `reinvite_weeks` per service
  (`null` = no reinvite). `aliases` maps other names used in the calendar.

The output folder contains customer data. Keep it outside the repository and
never commit the exported files.
