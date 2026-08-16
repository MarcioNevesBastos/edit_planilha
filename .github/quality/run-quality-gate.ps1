$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

function Invoke-Required($label, $command, $arguments) {
  Write-Output "EQC_${label}=RUN"
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Output "EQC_${label}=FAIL"
    Write-Output 'EQC_QUALITY_GATE=FAIL'
    exit 1
  }
  Write-Output "EQC_${label}=PASS"
}

Invoke-Required 'BUILD' 'npm' @('run', 'build')
Invoke-Required 'TYPECHECK' 'npm' @('run', 'typecheck')
Write-Output 'EQC_LINT=NA'
Invoke-Required 'TESTS' 'npm' @('test')
Invoke-Required 'COVERAGE' 'npm' @('run', 'test:coverage')

$coverage = Get-Content 'coverage/coverage-summary.json' -Raw | ConvertFrom-Json
$coverageValues = @($coverage.total.lines.pct, $coverage.total.functions.pct, $coverage.total.statements.pct, $coverage.total.branches.pct)
if (($coverageValues | Measure-Object -Minimum).Minimum -lt 90) { Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }
Write-Output "EQC_COVERAGE=$($coverageValues -join ',')"

& node '.github/quality/measure-complexity.mjs'
if ($LASTEXITCODE -ne 0) { Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }

& npm run check:duplication
if ($LASTEXITCODE -ne 0) { Write-Output 'EQC_DUPLICATION=FAIL'; Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }
$duplication = Get-Content '.eqc-jscpd-report/jscpd-report.json' -Raw | ConvertFrom-Json
$duplicationValue = [double]$duplication.statistics.total.percentage
if ($duplicationValue -gt 5) { Write-Output 'EQC_DUPLICATION=FAIL'; Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }
Write-Output "EQC_DUPLICATION=$duplicationValue%"

Invoke-Required 'CIRCULAR_DEPENDENCIES' 'npm' @('run', 'check:circular')
Write-Output 'EQC_CIRCULAR_DEPENDENCIES=0'

$auditJson = (& npm audit --audit-level=high --json 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { Write-Output 'EQC_SECURITY_CRITICAL=NAO_MEDIDA'; Write-Output 'EQC_SECURITY_HIGH=NAO_MEDIDA'; Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }
$audit = $auditJson | ConvertFrom-Json
$critical = [int]$audit.metadata.vulnerabilities.critical
$high = [int]$audit.metadata.vulnerabilities.high
if ($critical -gt 0 -or $high -gt 0) { Write-Output 'EQC_QUALITY_GATE=FAIL'; exit 1 }
Write-Output "EQC_SECURITY_CRITICAL=$critical"
Write-Output "EQC_SECURITY_HIGH=$high"

Invoke-Required 'CRITICAL_FLOWS' 'npm' @('run', 'test:e2e')
Write-Output 'EQC_CRITICAL_FLOWS=100%'
Write-Output 'EQC_QUALITY_GATE=PASS'
