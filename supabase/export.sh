#!/usr/bin/env bash
# =============================================================================
# LEVROMART · re-export the live database into readable, ordered SQL files.
# Usage:  DB_URL="postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres" ./supabase/export.sh
# Needs the PostgreSQL client tools (pg_dump). Output goes to supabase/export/.
# NOTE: review the output before committing - functions that call external webhooks
#       (notify_email_on_notification, ring_callee_again) contain a webhook secret.
#       Replace it with a placeholder (e.g. '<WEBHOOK_SECRET>') before sharing.
# =============================================================================
set -euo pipefail
: "${DB_URL:?Set DB_URL to the Supabase connection string}"
OUT="$(dirname "$0")/export"; mkdir -p "$OUT"
pg_dump "$DB_URL" --schema-only --schema=public --no-owner --no-privileges              > "$OUT/00_full_schema.sql"
pg_dump "$DB_URL" --schema-only --schema=public --no-owner --no-privileges --section=pre-data  > "$OUT/10_types_and_tables.sql"
pg_dump "$DB_URL" --schema-only --schema=public --no-owner --no-privileges --section=post-data > "$OUT/20_indexes_constraints_triggers_policies.sql"
psql "$DB_URL" -At -c "select pg_get_functiondef(p.oid)||';' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by p.proname" > "$OUT/30_functions.sql"
psql "$DB_URL" -At -c "select 'select cron.schedule('||quote_literal(jobname)||','||quote_literal(schedule)||','||quote_literal(command)||');' from cron.job order by jobname" > "$OUT/40_cron_jobs.sql"
echo "Done -> $OUT"
