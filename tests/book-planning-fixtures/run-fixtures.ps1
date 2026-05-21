# Book-planning fixture runner.
#
# Reads each .json fixture in this directory, POSTs to /api/projects to create
# the project, optionally kicks off planning execution, and prints the project
# IDs returned. Designed to be safe by default: creates projects without
# executing unless -Execute is passed.

param(
    [string]$Fixture = "",
    [switch]$Execute,
    [switch]$Watch,
    [string]$ApiBase = "http://localhost:3847",
    [string]$EnvFile = "D:\perry-system\.env"
)

# Resolve API key from .env
$apiKey = (Get-Content $EnvFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^PERRY_API_KEY=' }) -replace '^PERRY_API_KEY=', ''
if (-not $apiKey) { Write-Error "PERRY_API_KEY not found in $EnvFile"; exit 1 }
$h = @{ Authorization = "Bearer $apiKey"; "Content-Type" = "application/json" }

# Pick fixture files to run
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pattern = if ($Fixture) { "$Fixture.json" } else { "*.json" }
$files = Get-ChildItem -Path $dir -Filter $pattern -File | Where-Object { $_.Name -ne "package.json" }
if (-not $files) { Write-Error "No fixtures found matching '$pattern' in $dir"; exit 1 }

$created = @()
foreach ($f in $files) {
    Write-Host ""
    Write-Host "=== $($f.Name) ===" -ForegroundColor Cyan
    $body = Get-Content $f.FullName -Raw
    try {
        $r = Invoke-RestMethod -Uri "$ApiBase/api/projects" -Method Post -Headers $h -Body $body -ErrorAction Stop
        Write-Host "  Created:   $($r.id)" -ForegroundColor Green
        Write-Host "  Title:     $($r.title)"
        Write-Host "  Pen name:  $($r.context.penName)"
        Write-Host "  Steps:     $($r.steps.Count)"
        Write-Host "  Dashboard: $ApiBase/projects/$($r.id)"
        $created += @{ id = $r.id; title = $r.title; fixture = $f.Name }
    } catch {
        Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails) { Write-Host "        $($_.ErrorDetails.Message)" -ForegroundColor Red }
        continue
    }

    if ($Execute) {
        try {
            Invoke-RestMethod -Uri "$ApiBase/api/projects/$($r.id)/execute" -Method Post -Headers $h -ErrorAction Stop | Out-Null
            Write-Host "  Execution started" -ForegroundColor Yellow
        } catch {
            Write-Host "  Execute FAILED: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
"Created $($created.Count) project(s)."
$created | ForEach-Object { "  $($_.id)  $($_.title)  ($($_.fixture))" }

if ($Watch -and $Execute) {
    Write-Host ""
    Write-Host "=== Watching project status (Ctrl+C to stop) ===" -ForegroundColor Cyan
    while ($true) {
        Start-Sleep -Seconds 10
        $line = (Get-Date).ToString("HH:mm:ss") + "  "
        foreach ($p in $created) {
            try {
                $pr = Invoke-RestMethod -Uri "$ApiBase/api/projects/$($p.id)" -Headers $h
                $line += "$($p.id):$($pr.status)/$($pr.progress)%  "
            } catch { $line += "$($p.id):?  " }
        }
        Write-Host $line
        $allDone = $true
        foreach ($p in $created) {
            try {
                $pr = Invoke-RestMethod -Uri "$ApiBase/api/projects/$($p.id)" -Headers $h
                if ($pr.status -ne 'completed' -and $pr.status -ne 'failed') { $allDone = $false }
            } catch { $allDone = $false }
        }
        if ($allDone) { Write-Host "All projects complete."; break }
    }
}
