#!/usr/bin/env bash
# Realign every clinlims sequence whose `last_value` has fallen at-or-below
# its table's MAX(id). This unblocks a deployment hitting:
#
#   ERROR: duplicate key value violates unique constraint "<table>_pk"
#   Detail: Key (id)=(N) already exists.
#
# Root cause: at some point, rows were inserted into the table with
# explicit IDs (manual SQL, fixture loader, distro CSV handler, prior
# OGC-654 seed before commit 60ca829, etc.) without advancing the
# corresponding Hibernate sequence. Operator-driven inserts then call
# nextval and collide with the planted rows.
#
# Safety: setval only ADVANCES sequences (never moves backward). Idempotent
# and non-destructive — no row data is modified.
#
# Usage:
#   ./scripts/realign-sequences.sh
#   DB_CONTAINER=openelisglobal-database ./scripts/realign-sequences.sh
#   DB_CONTAINER=<other-container-name> ./scripts/realign-sequences.sh
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-openelisglobal-database}"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: container '$DB_CONTAINER' not running."
  echo "  Set DB_CONTAINER=<name> or start the OE2 stack first."
  exit 1
fi

REALIGN_SQL='
DO $$
DECLARE
  r RECORD;
  max_id BIGINT;
  seq_val BIGINT;
  fixed INT := 0;
BEGIN
  FOR r IN
    SELECT s.sequencename AS seq, regexp_replace(s.sequencename, ''_seq$'','''') AS tbl
    FROM pg_sequences s
    WHERE s.schemaname=''clinlims'' AND s.sequencename LIKE ''%_seq''
  LOOP
    BEGIN
      EXECUTE format(''SELECT COALESCE(MAX(id),0) FROM clinlims.%I'', r.tbl) INTO max_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      CONTINUE;
    END;
    EXECUTE format(''SELECT last_value FROM clinlims.%I'', r.seq) INTO seq_val;
    IF max_id > seq_val THEN
      EXECUTE format(''SELECT setval(%L, %L)'', ''clinlims.'' || r.seq, max_id);
      RAISE NOTICE ''realigned table=% seq %% -> %'', r.tbl, seq_val, max_id;
      fixed := fixed + 1;
    END IF;
  END LOOP;
  RAISE NOTICE ''sequences realigned: %'', fixed;
END$$;
'

echo "[realign] target container: $DB_CONTAINER"
# psql echoes NOTICEs to stderr-via-2>&1; grep with || true so a clean DB
# (zero realignments) doesn't make the script exit non-zero.
docker exec "$DB_CONTAINER" psql -U clinlims -d clinlims -c "$REALIGN_SQL" 2>&1 \
  | grep -E 'realigned|sequences' || true
echo "[realign] done."
