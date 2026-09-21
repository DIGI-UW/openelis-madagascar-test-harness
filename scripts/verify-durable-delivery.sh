#!/usr/bin/env bash
#
# The Madagascar incident, run against the assembled distro stack.
#
# Same scenario the bridge's own acceptance suite covers, but with the real
# OpenELIS images this distro ships rather than a stub: OpenELIS is stopped, an
# analyzer sends a result, the bridge is restarted mid-outage, OpenELIS comes
# back, and the result must arrive exactly once with its content intact.
#
# Intended for a stack already brought up by scripts/restart-stack.sh. Needs the
# validate overlay (for the analyzer mock) and a seeded GeneXpert connection.

set -euo pipefail

BRIDGE_URL="${BRIDGE_URL:-https://localhost:8442}"
BRIDGE_USER="${BRIDGE_USER:-admin}"
BRIDGE_PASSWORD="${BRIDGE_PASSWORD:-adminADMIN!}"
SIMULATOR_URL="${SIMULATOR_URL:-http://localhost:8085}"
OE_CONTAINER="${OE_CONTAINER:-openelisglobal-webapp}"
BRIDGE_CONTAINER="${BRIDGE_CONTAINER:-openelis-analyzer-bridge}"
DB_CONTAINER="${DB_CONTAINER:-openelisglobal-database}"
# The port the bridge's saved GeneXpert connection listens on. The seeded harness
# connection uses 9600; a different site binding may use another port.
ASTM_DESTINATION="${ASTM_DESTINATION:-tcp://openelis-analyzer-bridge:9600}"

outbox() {
    curl --silent --show-error --insecure --user "${BRIDGE_USER}:${BRIDGE_PASSWORD}" "${BRIDGE_URL}/admin/outbox$1"
}

if ! outbox "/stats" | jq -e '.byState' >/dev/null 2>&1; then
    echo "This bridge has no delivery outbox at ${BRIDGE_URL}/admin/outbox." >&2
    echo "Bring the stack up with a bridge image built from the outbox branch." >&2
    exit 2
fi

echo "Stopping OpenELIS..."
docker stop "${OE_CONTAINER}" >/dev/null
restore() { docker start "${OE_CONTAINER}" >/dev/null 2>&1 || true; }
trap restore EXIT

# The analyzer mock reuses accession numbers, so an accession alone can match a
# result delivered earlier in this stack's life. Snapshot the ids that already
# exist and look only for one that appears after this send.
before="$(outbox "?limit=500&includeDismissed=true" | jq --raw-output '[.rows[].id] | join(" ")')"

# A distinct sample per run. The mock otherwise emits byte-identical messages, and
# the bridge derives a delivery's identity from its content, so a repeat would be
# recognized as the retransmission it is rather than treated as a new result.
# The mock requires a site accession: DEV01 followed by fifteen digits.
sample="DEV01$(date +%s)0$(printf '%04d' $((RANDOM % 10000)))"

echo "Sending a GeneXpert result into the outage..."
accession="$(curl --silent --show-error --fail-with-body \
    --request POST --header 'Content-Type: application/json' \
    --data "{\"count\":1,\"sample_id\":\"${sample}\",\"destination\":\"${ASTM_DESTINATION}\"}" \
    "${SIMULATOR_URL}/simulate/astm/genexpert_astm" \
    | jq --raw-output '.results[0].sample_id // .sample_id // empty')"
[ -n "${accession}" ] || { echo "The analyzer mock did not report a sample id" >&2; exit 1; }
echo "  accession ${accession}"

id=""
for _ in $(seq 1 30); do
    id="$(outbox "?limit=500&includeDismissed=true" | jq --raw-output --arg a "${accession}" --arg seen "${before}" \
        '($seen | split(" ")) as $known
         | first(.rows[] | select(.accession == $a) | .id | select(IN($known[]) | not)) // empty')"
    [ -n "${id}" ] && break
    sleep 1
done
[ -n "${id}" ] || { echo "The bridge never recorded a result for ${accession}" >&2; exit 1; }
echo "  held as ${id}"

raw="$(curl --silent --insecure --user "${BRIDGE_USER}:${BRIDGE_PASSWORD}" "${BRIDGE_URL}/admin/outbox/${id}/payload?part=raw")"
grep -q "${accession}" <<<"${raw}" || { echo "The stored message is not the one that was sent" >&2; exit 1; }
echo "  complete message held: ${#raw} bytes"

echo "Restarting the bridge..."
docker restart "${BRIDGE_CONTAINER}" >/dev/null
for _ in $(seq 1 90); do
    outbox "/stats" >/dev/null 2>&1 && break
    sleep 2
done
state="$(outbox "/${id}" | jq --raw-output '.state')"
case "${state}" in
    RECEIVED|PENDING|RETRYING) ;;
    *)
        echo "Expected the result to still be undelivered after the restart, saw ${state}" >&2
        echo "OpenELIS was supposed to be stopped for this entire window." >&2
        outbox "/${id}" | jq '{state, attempts, lastError, lastHttpStatus}' >&2
        exit 1
        ;;
esac
echo "  survived the restart as ${state}"

echo "Bringing OpenELIS back..."
docker start "${OE_CONTAINER}" >/dev/null
trap - EXIT

for _ in $(seq 1 150); do
    state="$(outbox "/${id}" | jq --raw-output '.state')"
    [ "${state}" = "DELIVERED" ] && break
    sleep 4
done
[ "${state}" = "DELIVERED" ] || {
    echo "The result never reached OpenELIS (last state ${state})" >&2
    outbox "/${id}" | jq '{state, attempts, failureReason, lastError, lastHttpStatus}' >&2
    exit 1
}

# One acceptance record for this delivery: the retries must not have created a
# second one. Counting staged rows by accession would be ambiguous here, because
# the analyzer mock reuses accession numbers across runs.
receipts="$(docker exec "${DB_CONTAINER}" psql -U clinlims -d clinlims -tAc \
    "SELECT COUNT(*) FROM clinlims.analyzer_delivery_receipt WHERE message_id = '${id}'")"
[ "${receipts//[[:space:]]/}" = "1" ] || {
    echo "Expected exactly one OpenELIS acceptance for this delivery, found ${receipts}" >&2
    exit 1
}
echo "  OpenELIS recorded exactly one acceptance for this delivery"

echo "Result survived an OpenELIS outage and a bridge restart, and was staged once."
