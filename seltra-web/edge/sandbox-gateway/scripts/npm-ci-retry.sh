#!/usr/bin/env bash
set -uo pipefail

max_retries=3
retries=0
attempt=1
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

while true; do
  started_at=$SECONDS
  npm ci --loglevel=error "$@" >"$log_file" 2>&1
  status=$?
  elapsed_ms=$(((SECONDS - started_at) * 1000))
  if (( status == 0 )); then
    echo "npm ci passed (attempt ${attempt}, elapsed_ms=${elapsed_ms})"
    exit 0
  fi
  if grep -Eiq 'ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|EAI_AGAIN|EHOSTUNREACH|ENOTFOUND|socket hang up|fetch failed|HTTP 50[234]|\b50[234]\b|network.*(timeout|failure|error)|network timeout' "$log_file"; then
    signals=$(grep -Eo 'ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|EAI_AGAIN|EHOSTUNREACH|ENOTFOUND|50[234]' "$log_file" | sort -u | paste -sd, - || true)
    hosts=$(grep -Eo 'https?://[^/[:space:]\")>]+' "$log_file" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#:[0-9]+$##' | sort -u | head -n 5 | paste -sd, - || true)
    if (( retries < max_retries )); then
      retries=$((retries + 1))
      echo "npm ci network failure; retry ${retries}/${max_retries}; elapsed_ms=${elapsed_ms}; signals=${signals:-unknown}; hosts=${hosts:-unknown}"
      sleep $((2 ** retries))
      attempt=$((attempt + 1))
      continue
    fi
    echo "npm ci failed after ${attempt} attempts (network error; retries exhausted; elapsed_ms=${elapsed_ms}; signals=${signals:-unknown}; hosts=${hosts:-unknown})"
  else
    error_code=$(grep -Eo 'npm error code [A-Z0-9_-]+' "$log_file" | tail -n 1 | sed 's/^npm error code //')
    echo "npm ci failed (non-network error; status=${status}; error_code=${error_code:-unknown}; elapsed_ms=${elapsed_ms})"
  fi
  exit "$status"
done
