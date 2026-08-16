$inputJson = [Console]::In.ReadToEnd()
$stopHookActive = $false
try { $stopHookActive = [bool](($inputJson | ConvertFrom-Json).stop_hook_active) } catch {}
if ($stopHookActive) { exit 0 }

$output = & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/run-quality-gate.ps1" 2>&1
if ($LASTEXITCODE -eq 0) {
  $output | Write-Output
  exit 0
}
$output | Write-Error
Write-Output '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"EQC quality gate falhou. Corrija os bloqueadores, execute as validações novamente e somente então finalize."}}'
