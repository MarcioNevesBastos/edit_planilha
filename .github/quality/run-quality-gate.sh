#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

fail_gate() {
  echo "EQC_QUALITY_GATE=FAIL"
  exit 1
}

run_required() {
  local label="$1"
  shift
  echo "EQC_${label}=RUN"
  if "$@"; then
    echo "EQC_${label}=PASS"
  else
    echo "EQC_${label}=FAIL"
    fail_gate
  fi
}

run_required BUILD npm run build
run_required TYPECHECK npm run typecheck
echo "EQC_LINT=NA"
run_required TESTS npm test
run_required COVERAGE npm run test:coverage

coverage_value="$(node --input-type=module -e "import fs from 'node:fs'; const data=JSON.parse(fs.readFileSync('coverage/coverage-summary.json','utf8')); const total=data.total; const values=['lines','functions','statements','branches'].map((key)=>Number(total[key].pct)); if (values.some((value)=>!Number.isFinite(value)) || Math.min(...values)<90) process.exit(1); console.log(values.map((value)=>value.toFixed(2)).join(','));")" || fail_gate
echo "EQC_COVERAGE=${coverage_value}"

complexity_output="$(node .github/quality/measure-complexity.mjs 2>&1)"
complexity_status=$?
echo "$complexity_output"
if [ "$complexity_status" -ne 0 ]; then
  fail_gate
fi

mkdir -p .eqc-jscpd-report || fail_gate
duplication_output="$(npm run check:duplication 2>&1)"
duplication_status=$?
echo "$duplication_output"
if [ "$duplication_status" -ne 0 ]; then
  echo "EQC_DUPLICATION=FAIL"
  fail_gate
fi
duplication_value="$(node --input-type=module -e "import fs from 'node:fs'; const data=JSON.parse(fs.readFileSync('.eqc-jscpd-report/jscpd-report.json','utf8')); const value=Number(data.statistics.total.percentage); if(!Number.isFinite(value) || value>5) process.exit(1); console.log(value.toFixed(2)+'%');")" || fail_gate
echo "EQC_DUPLICATION=${duplication_value}"

run_required CIRCULAR_DEPENDENCIES npm run check:circular
echo "EQC_CIRCULAR_DEPENDENCIES=0"

audit_output="$(npm audit --audit-level=high --json 2>&1)"
audit_status=$?
echo "$audit_output"
if [ "$audit_status" -ne 0 ]; then
  echo "EQC_SECURITY_CRITICAL=NAO_MEDIDA"
  echo "EQC_SECURITY_HIGH=NAO_MEDIDA"
  fail_gate
fi
security_values="$(printf '%s' "$audit_output" | node --input-type=module -e "import fs from 'node:fs'; const input=fs.readFileSync(0,'utf8'); const data=JSON.parse(input); const vulnerabilities=data.metadata?.vulnerabilities ?? {}; const critical=Number(vulnerabilities.critical ?? 0); const high=Number(vulnerabilities.high ?? 0); if(critical>0 || high>0) process.exit(1); console.log(critical+','+high);")" || fail_gate
echo "EQC_SECURITY_CRITICAL=${security_values%%,*}"
echo "EQC_SECURITY_HIGH=${security_values##*,}"

run_required CRITICAL_FLOWS npm run test:e2e
echo "EQC_CRITICAL_FLOWS=100%"
echo "EQC_QUALITY_GATE=PASS"
