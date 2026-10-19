param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $nodeVersion = & $nodeCommand.Source --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24 or later is required.' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    $deskDataDir = if ($env:AGENT_DESK_DATA_DIR) { $env:AGENT_DESK_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'AgentDesk' }
    New-Item -ItemType Directory -Path $deskDataDir -Force | Out-Null
    $runtimePath = Join-Path $deskDataDir 'runtime.json'
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
    $url = $null
    if (Test-Path -LiteralPath $runtimePath) {
        try {
            $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
            $running = Get-Process -Id $runtime.pid -ErrorAction Stop
            if ($running.ProcessName -eq 'node') {
                $candidate = 'http://127.0.0.1:' + $runtime.port
                $check = Invoke-RestMethod -Uri ($candidate + '/api/bootstrap') -TimeoutSec 2
                if ($check.app -eq 'agent-desk' -and $check.processId -eq $runtime.pid -and $check.version -eq $manifest.version -and $check.dataDirectory -eq $deskDataDir) { $url = $candidate }
            }
        } catch {}
    }
    if (-not $url) {
        $serverPath = Join-Path $PSScriptRoot 'server\index.mjs'
        $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $deskDataDir 'server.log') -RedirectStandardError (Join-Path $deskDataDir 'server-error.log') -PassThru
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            Start-Sleep -Milliseconds 250
            if ($serverProcess.HasExited) { throw ('Server failed. Check ' + (Join-Path $deskDataDir 'server-error.log')) }
            try {
                $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
                if ($runtime.pid -eq $serverProcess.Id) {
                    $candidate = 'http://127.0.0.1:' + $runtime.port
                    $check = Invoke-RestMethod -Uri ($candidate + '/api/bootstrap') -TimeoutSec 2
                    if ($check.app -eq 'agent-desk' -and $check.processId -eq $serverProcess.Id -and $check.version -eq $manifest.version) { $url = $candidate; break }
                }
            } catch {}
        }
        if (-not $url) { throw 'Server startup timed out.' }
    }
    Write-Host ('Agent Desk is running: ' + $url)
    if (-not $NoOpen) { Start-Process $url }
} finally { Pop-Location }
