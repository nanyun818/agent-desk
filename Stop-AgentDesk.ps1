$ErrorActionPreference = 'Stop'
$deskDataDir = if ($env:AGENT_DESK_DATA_DIR) { $env:AGENT_DESK_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'AgentDesk' }
$runtimePath = Join-Path $deskDataDir 'runtime.json'
if (-not (Test-Path -LiteralPath $runtimePath)) { Write-Host 'Agent Desk is not running.'; return }
$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
if ($runtime.root -ne $PSScriptRoot) { throw 'This runtime belongs to a different checkout.' }
$deskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$runtime.pid)
if (-not $deskProcess) { Write-Host 'Agent Desk is not running.'; return }
$serverPath = Join-Path $PSScriptRoot 'server\index.mjs'
if ($deskProcess.Name -ne 'node.exe' -or -not $deskProcess.CommandLine.Contains($serverPath)) { throw 'The recorded PID does not match Agent Desk.' }
Stop-Process -Id $runtime.pid -ErrorAction Stop
Write-Host 'Agent Desk stopped. Your records are preserved.'
