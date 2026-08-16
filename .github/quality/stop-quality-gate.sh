#!/usr/bin/env bash

set -u

input="$(cat)"
stop_hook_active="$(printf '%s' "$input" | node --input-type=module -e "import fs from 'node:fs'; let data={}; try { data=JSON.parse(fs.readFileSync(0,'utf8')); } catch {} console.log(data.stop_hook_active === true ? 'true' : 'false');")"
if [ "$stop_hook_active" = "true" ]; then
  exit 0
fi

output_file="/tmp/eqc-quality-gate-output"
if bash .github/quality/run-quality-gate.sh >"$output_file" 2>&1; then
  cat "$output_file"
  exit 0
fi
cat "$output_file" >&2
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"EQC quality gate falhou. Corrija os bloqueadores, execute as validações novamente e somente então finalize."}}'
