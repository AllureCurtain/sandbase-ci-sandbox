#!/usr/bin/env bash
# Runs the wrangler version picked for this workflow run (input wrangler_version,
# exported as WRANGLER_VERSION). Installed as `wr` on PATH by d1-repro.yml.
#
#   wr <args...>             full output; WRANGLER_LOG comes from the job (debug)
#   WR_JSON=1 wr ... --json  log level "log", so stdout is only the JSON: debug
#                            lines also go to stdout and would break jq, and a
#                            level above "log" would drop the JSON itself
#
# Debug logs never contain the token: both 3.99 and 4.x delete the
# Authorization header before logging, and with WRANGLER_LOG_SANITIZE=true
# (the default, pinned by the workflow) headers and bodies are omitted.
set -euo pipefail
: "${WRANGLER_VERSION:?WRANGLER_VERSION is not set}"
if [ "${WR_JSON:-}" = 1 ]; then
  # 3.99 may print a warning line (e.g. proxy detected) to stdout before the
  # JSON array; keep stdout from the line that opens the array (`[`, `[{`,
  # `[]`), so a "[WARNING] ..." line is never mistaken for it.
  WRANGLER_LOG=log npx --yes "wrangler@${WRANGLER_VERSION}" "$@" | sed -nE '/^\[[[:space:]]*([{]|]|$)/,$p'
  exit
fi
exec npx --yes "wrangler@${WRANGLER_VERSION}" "$@"
