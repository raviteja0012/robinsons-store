#!/usr/bin/env bash
# Throwaway Postgres 16: demo install, migration rerun, enforced cutover, rerun again.
# Usage: run.sh <repo dir> <this dir>
set -euo pipefail
REPO="$1"; HERE="$2"; NAME="aiusage-pgcheck-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=x postgres:16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
run() { echo "== $1"; docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X -A -t -F ' | ' < "$2"; }
run "stubs" "$HERE/00_supabase_stubs.sql"
run "schema.sql" "$REPO/supabase/schema.sql"
run "ai_call.sql on a fresh install (idempotent)" "$REPO/supabase/ai_call.sql"
run "demo checks" "$HERE/10_demo_checks.sql"
run "members" "$HERE/15_members.sql"
run "auth_setup.sql" "$REPO/supabase/auth_setup.sql"
run "enforced checks" "$HERE/20_enforced_checks.sql"
run "ai_call.sql again, enforced" "$REPO/supabase/ai_call.sql"
run "auth_setup.sql again" "$REPO/supabase/auth_setup.sql"
run "rerun checks" "$HERE/30_rerun_checks.sql"
run "live path: drop" "$HERE/40_live_path.sql"
run "live path: ai_call.sql" "$REPO/supabase/ai_call.sql"
run "live path: before auth_setup" "$HERE/41_live_before_auth.sql"
run "live path: auth_setup.sql" "$REPO/supabase/auth_setup.sql"
run "live path: enforced checks again" "$HERE/30_rerun_checks.sql"
echo "== done"
