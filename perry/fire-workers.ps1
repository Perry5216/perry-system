# fire-workers.ps1 — Spawn N headless `claude` CLI workers to drain the
# Perry MCP task queue. Sizes the swarm to current queue depth.
#
# Usage:
#   .\perry\fire-workers.ps1                         # auto-size, cap 20
#   .\perry\fire-workers.ps1 -Max 30                 # higher ceiling
#   .\perry\fire-workers.ps1 -TasksPerWorker 50      # heavier per-worker batches
#   .\perry\fire-workers.ps1 -DryRun                 # show plan, don't fire
#
# Each worker invokes the /perry-worker slash command via `claude -p` in
# headless mode. It exits cleanly after 6 consecutive empty claims (~2 min
# idle) OR after its --max-turns budget, whichever comes first.

[CmdletBinding()]
param(
    [string]$Agent = "claude",
    [int]$Max = 20,
    [int]$TasksPerWorker = 30,
    [string]$DashboardUrl = "http://localhost:3847",
    [string]$WorkDir = "d:\n8n",
    [switch]$DryRun
)

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "PowerShell 7+ required for ForEach-Object -Parallel."
    exit 1
}

# 1) Read current queue depth from dashboard API.
try {
    $r = Invoke-RestMethod -Uri "$DashboardUrl/api/system/workers" -TimeoutSec 5
} catch {
    Write-Error "Dashboard API unreachable at $DashboardUrl. Is perry up?"
    exit 1
}
$open    = [int]$r.depth.open
$active  = [int]$r.active
$claimed = [int]$r.depth.claimed
$done    = [int]$r.depth.done

Write-Host ""
Write-Host "Queue state:" -ForegroundColor Cyan
Write-Host ("  open       {0,5}" -f $open)
Write-Host ("  claimed    {0,5}" -f $claimed)
Write-Host ("  done       {0,5}  (waiting on collector)" -f $done)
Write-Host ("  active     {0,5}  workers in last 120s" -f $active)
Write-Host ""

if ($open -le 0) {
    Write-Host "Nothing open. Either the queue's drained or workers haven't enqueued yet." -ForegroundColor Yellow
    Write-Host "If you expected tasks: docker exec perry-trainer python3 /workspace/.config/_topup_v4_synth.py" -ForegroundColor DarkGray
    exit 0
}

# 2) Size the swarm. Aim for ~$TasksPerWorker tasks per worker so each one
# does meaningful work before exiting. Cap at $Max so we don't blow through
# the Claude account rate limit.
$want = [Math]::Ceiling($open / [Math]::Max(1, $TasksPerWorker))
$n = [Math]::Min([Math]::Max(1, $want), $Max)

# Give each worker a turn budget proportional to their share, with slack so
# they don't bail mid-task if queue grows during the run. One turn ≈ one
# claim+report cycle.
$turnsPerWorker = [Math]::Max(20, [int]([Math]::Ceiling($open / $n) * 1.5))

Write-Host "Plan:" -ForegroundColor Green
Write-Host ("  agent         {0}" -f $Agent)
Write-Host ("  workers       {0}" -f $n)
Write-Host ("  turns/worker  {0}" -f $turnsPerWorker)
Write-Host ("  expected      ~{0:N0} tasks total per CLI session if queue holds" -f ($n * $turnsPerWorker))
Write-Host ("  log dir       {0}" -f $env:TEMP)
Write-Host ""

if ($DryRun) {
    Write-Host "DryRun: not firing." -ForegroundColor Yellow
    exit 0
}

# 3) Per-run log dir keyed by timestamp so back-to-back runs don't collide.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $env:TEMP "perry-workers-$stamp"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Write-Host "Logs: $logDir" -ForegroundColor DarkGray
Write-Host ""

# 4) Fire. ForEach-Object -Parallel runs each iteration in its own runspace.
$start = Get-Date
$results = 1..$n | ForEach-Object -ThrottleLimit $n -Parallel {
    $idx = $_
    $log = Join-Path $using:logDir ("worker-{0:D2}.log" -f $idx)
    Set-Location $using:WorkDir
    if ($using:Agent -match 'antigrav') {
        & antigravity chat -r "/perry-worker" > $log 2>&1
        Start-Sleep -Seconds 90
    } else {
        $args = @(
            "-p", "/perry-worker",
            "--max-turns", "$($using:turnsPerWorker)",
            "--dangerously-skip-permissions"
        )
        & claude @args > $log 2>&1
    }
    $exit = $LASTEXITCODE
    [pscustomobject]@{
        Worker = $idx
        Exit   = $exit
        Log    = $log
    }
}
$elapsed = (Get-Date) - $start

# 5) Summary.
$ok   = ($results | Where-Object { $_.Exit -eq 0 }).Count
$fail = ($results | Where-Object { $_.Exit -ne 0 }).Count
Write-Host ""
Write-Host ("Done in {0:N0}s. {1}/{2} workers exited cleanly." -f $elapsed.TotalSeconds, $ok, $n) `
    -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Yellow' })

# Post-run queue state.
try {
    $r2 = Invoke-RestMethod -Uri "$DashboardUrl/api/system/workers" -TimeoutSec 5
    Write-Host ""
    Write-Host "Queue after run:" -ForegroundColor Cyan
    Write-Host ("  open       {0,5}  (was {1})" -f [int]$r2.depth.open,    $open)
    Write-Host ("  done       {0,5}  (was {1})" -f [int]$r2.depth.done,    $done)
    Write-Host ("  failed     {0,5}" -f [int]$r2.depth.failed)
} catch { }

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "Failed workers — check logs for rate_limit_exceeded:" -ForegroundColor Yellow
    $results | Where-Object { $_.Exit -ne 0 } | ForEach-Object {
        Write-Host ("  worker-{0:D2}  exit={1}  {2}" -f $_.Worker, $_.Exit, $_.Log)
    }
}
