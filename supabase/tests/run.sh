#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres and runs the access checks.
# Needs Postgres 15+ binaries (initdb, pg_ctl, psql). Touches nothing remote.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
dir="$(mktemp -d)"
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$dir"
trap 'run "$bin/pg_ctl -D $dir/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
run "$bin/initdb -D $dir/data -U postgres --auth=trust" >/dev/null
run "$bin/pg_ctl -D $dir/data -o '-p 54329 -k $dir' -l $dir/log start -w" >/dev/null
psql=(psql -h "$dir" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${psql[@]}" -f "$here/stub_supabase.sql"
for f in "$here"/../migrations/*.sql; do echo "== $(basename "$f")"; "${psql[@]}" -f "$f" 2>&1 | grep -v 'not found, skipped' || true; done
"${psql[@]}" -tAc "select 'seed: ' || count(*) || ' services for ' || string_agg(distinct s.name, ',') from services v join salons s on s.id = v.salon_id"
echo "== rls_test.sql"
"${psql[@]}" -f "$here/rls_test.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
