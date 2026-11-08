#!/usr/bin/env bash
set -uo pipefail

max_retries=3
retries=0
attempt=1
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

while true; do
  npm ci --loglevel=error "$@" >"$log_file" 2>&1
  status=$?
  if (( status == 0 )); then
    echo "npm ci passed (attempt ${attempt})"
    exit 0
  fi
  if grep -Eiq 'ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|EAI_AGAIN|EHOSTUNREACH|ENOTFOUND|socket hang up|fetch failed|HTTP 50[234]|\b50[234]\b|network.*(timeout|failure|error)|network timeout' "$log_file"; then
    if (( retries < max_retries )); then
      retries=$((retries + 1))
      echo "npm ci network failure; retry ${retries}/${max_retries}"
      sleep $((2 ** retries))
      attempt=$((attempt + 1))
      continue
    fi
    echo "npm ci failed after ${attempt} attempts (network error; retries exhausted)"
  else
    echo "npm ci failed (non-network error; status ${status})"
    grep -Eo 'npm error code [A-Z0-9_-]+|npm error command failed|npm error path [^[:space:]]+' "$log_file" | tail -n 5 || true
  fi
  exit "$status"
done
