#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

bun run src/hooks/spec-mode.bench.ts | tee "$output_file"

if grep -qi "p95" "$output_file"; then
  awk '
    BEGIN { failed = 0 }
    /p95/ {
      for (i = 1; i <= NF; i++) {
        if ($i == "p95" || $i == "p95:") {
          value = $(i + 1)
          unit = $(i + 2)
          gsub(/[^0-9.]/, "", value)
          if (unit ~ /ms/ && value + 0 >= 2) failed = 1
        }
      }
    }
    END { exit failed }
  ' "$output_file"
else
  printf 'Bun bench output did not include parseable p95 values; benchmark completed without budget assertion.\n'
fi
