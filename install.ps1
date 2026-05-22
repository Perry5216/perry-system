#Requires -Version 5.1
<#
.SYNOPSIS
    Perry one-shot installer for Windows. Asks a handful of questions and
    brings up a tailored Docker stack — local-only by default, public via
    Cloudflare Tunnel optional, VPN scouting optional, book covers optional.

.DESCRIPTION
    Designed to be invoked as `irm https://perry.5216perry.uk/install.ps1 | iex`
    or `irm https://raw.githubusercontent.com/Perry5216/perry-system/main/install.ps1 | iex`.

    Asks 6 questions, then:
      1. Clones Perry5216/perry-system into a chosen directory
      2. Generates .env with random PERRY_VAULT_KEY / PERRY_API_KEY /
         PERRY_WORKER_SECRET hex secrets
      3. Sets COMPOSE_PROFILES based on opt-ins (public / vpn / covers)
      4. Runs `docker compose up -d` for the chosen profile set
      5. Waits for the perry container's /api/system/health to return OK
      6. Prints a setup summary with the dashboard URL, API key, and the
         per-CLI `claude login` / `gemini login` / `codex login` reminders

    Subscription-only design: never collects metered API keys. Workers
    use the operator's existing CLI subscriptions (Claude Pro/Max, Gemini
    Advanced, ChatGPT Plus/Pro) via the host-mounted OAuth dirs.

.NOTES
    Idempotent for re-runs against an existing checkout — re-uses the
    existing .env if present (prompts before overwriting).
#>

[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'

# ─── Console rendering ──────────────────────────────────────────────────

function Write-Banner {
    Write-Host ''
    Write-Host '  ╔═══════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║                                                               ║' -ForegroundColor Cyan
    Write-Host '  ║   P.E.R.R.Y.  —  Self-hosted multi-agent AI platform          ║' -ForegroundColor Cyan
    Write-Host '  ║   Prose · Evaluation · Research · Revision Engine             ║' -ForegroundColor Cyan
    Write-Host '  ║                                                               ║' -ForegroundColor Cyan
    Write-Host '  ╚═══════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  This installer asks a handful of questions, generates a tailored' -ForegroundColor Gray
    Write-Host '  .env and compose profile set, then brings up the stack. Takes' -ForegroundColor Gray
    Write-Host '  3-5 minutes after the questions are answered.' -ForegroundColor Gray
    Write-Host ''
}

function Write-Section($label) {
    Write-Host ''
    Write-Host "─── $label " -ForegroundColor Cyan -NoNewline
    Write-Host ('─' * [Math]::Max(1, 60 - $label.Length)) -ForegroundColor Cyan
}

function Write-Step($msg)    { Write-Host "  → $msg" -ForegroundColor White }
function Write-Ok($msg)      { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)    { Write-Host "  ✗ $msg" -ForegroundColor Red }

function Read-Choice {
    param(
        [string]$Prompt,
        [string[]]$Options,
        [int]$Default = 0
    )
    Write-Host ''
    Write-Host "  $Prompt" -ForegroundColor White
    for ($i = 0; $i -lt $Options.Length; $i++) {
        $marker = if ($i -eq $Default) { '*' } else { ' ' }
        Write-Host ("    [$($i+1)]$marker $($Options[$i])") -ForegroundColor Gray
    }
    while ($true) {
        $resp = Read-Host "  Choice (1-$($Options.Length))"
        if ([string]::IsNullOrWhiteSpace($resp)) { return $Default }
        if ($resp -match '^\d+$' -and [int]$resp -ge 1 -and [int]$resp -le $Options.Length) {
            return [int]$resp - 1
        }
        Write-Warn "Please enter a number between 1 and $($Options.Length)."
    }
}

function Read-YesNo {
    param([string]$Prompt, [bool]$Default = $true)
    $hint = if ($Default) { 'Y/n' } else { 'y/N' }
    while ($true) {
        $resp = Read-Host "  $Prompt [$hint]"
        if ([string]::IsNullOrWhiteSpace($resp)) { return $Default }
        if ($resp -match '^[yY]') { return $true }
        if ($resp -match '^[nN]') { return $false }
        Write-Warn 'Please answer y or n.'
    }
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $buf = [byte[]]::new($Bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $_.ToString('x2') })
}

# ─── Prerequisite checks ───────────────────────────────────────────────

function Test-Prerequisites {
    Write-Section 'Checking prerequisites'

    $issues = @()

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        $issues += 'Docker is not installed. Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/'
    } else {
        Write-Ok 'docker found'
        try {
            $null = docker info 2>$null
            if ($LASTEXITCODE -ne 0) { throw }
            Write-Ok 'docker daemon is running'
        } catch {
            $issues += 'Docker is installed but the daemon is not running. Open Docker Desktop and wait for it to start.'
        }
    }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        $issues += 'git is not installed. Install from https://git-scm.com/download/win'
    } else {
        Write-Ok 'git found'
    }

    # GPU is a soft requirement — perry runs without NVIDIA but the local
    # LLM stack does. Warn, don't block.
    $hasNvidia = $false
    try {
        $null = nvidia-smi -L 2>$null
        if ($LASTEXITCODE -eq 0) { $hasNvidia = $true }
    } catch {}
    if ($hasNvidia) {
        Write-Ok 'NVIDIA GPU detected'
    } else {
        Write-Warn 'No NVIDIA GPU detected — ollama / comfyui containers expect CUDA.'
        Write-Warn 'You can still install, but the local LLM stack will fail to start.'
    }

    if ($issues.Count -gt 0) {
        Write-Host ''
        foreach ($issue in $issues) { Write-Fail $issue }
        throw 'Prerequisite check failed. See errors above.'
    }
}

# ─── Install directory + clone ─────────────────────────────────────────

function Get-InstallDirectory {
    if ($InstallDir) {
        $resolved = $InstallDir
    } else {
        $default = Join-Path (Get-Location) 'perry-system'
        Write-Section 'Install location'
        $resp = Read-Host "  Install directory [$default]"
        $resolved = if ([string]::IsNullOrWhiteSpace($resp)) { $default } else { $resp }
    }
    # Resolve to absolute path
    if (-not [System.IO.Path]::IsPathRooted($resolved)) {
        $resolved = Join-Path (Get-Location) $resolved
    }
    return $resolved
}

function Initialize-Checkout {
    param([string]$Dir)
    Write-Section 'Cloning the repository'

    if (Test-Path $Dir) {
        if (Test-Path (Join-Path $Dir '.git')) {
            Write-Warn "Existing checkout found at $Dir"
            if (Read-YesNo 'Skip clone and reuse existing checkout?' $true) {
                Write-Ok "Reusing $Dir"
                return
            }
        }
        if ((Get-ChildItem $Dir -Force | Measure-Object).Count -gt 0) {
            throw "Directory $Dir exists and is not empty. Delete it or choose another location."
        }
    } else {
        New-Item -ItemType Directory -Path $Dir | Out-Null
    }

    Write-Step "git clone https://github.com/Perry5216/perry-system.git $Dir"
    git clone https://github.com/Perry5216/perry-system.git $Dir
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
    Write-Ok 'Repository cloned'
}

# ─── Wizard questions ───────────────────────────────────────────────────

function Invoke-Wizard {
    Write-Section 'Configuration wizard'
    Write-Host '  Answer 6 questions. Defaults are marked with *.' -ForegroundColor Gray

    $answers = [ordered]@{}

    # Q1: Access scope
    $scopeChoice = Read-Choice -Prompt 'Q1. Who needs to reach Perry''s dashboard?' -Options @(
        'Local-only — just this machine (http://localhost:3847)',
        'LAN — other devices on your network',
        'Public — anywhere on the internet via Cloudflare Tunnel'
    ) -Default 0
    $answers.AccessScope = @('local', 'lan', 'public')[$scopeChoice]

    # Q2: CLI subscriptions (multi-select via repeated yes/no)
    Write-Host ''
    Write-Host '  Q2. Which subscription CLIs do you want to enable as workers?' -ForegroundColor White
    Write-Host '       (multi-select — at least one is recommended for non-trivial tasks)' -ForegroundColor Gray
    $answers.UseClaude = Read-YesNo '       Anthropic CLI (Pro / Max plan)?' $true
    $answers.UseGemini = Read-YesNo '       Google Gemini CLI (Advanced plan)?' $true
    $answers.UseCodex  = Read-YesNo '       OpenAI Codex CLI (ChatGPT Plus / Pro / Business plan)?' $false
    if (-not ($answers.UseClaude -or $answers.UseGemini -or $answers.UseCodex)) {
        Write-Warn 'No CLIs selected — Perry will only do local-model work (limited).'
    }

    # Q3: GPU layout
    $gpuChoice = Read-Choice -Prompt 'Q3. GPU layout?' -Options @(
        'Single GPU (everything shares one card)',
        'Dual GPU (writer on GPU 0, librarian/embeddings on GPU 1)'
    ) -Default 0
    $answers.DualGpu = ($gpuChoice -eq 1)

    # Q4: Book covers
    Write-Host ''
    $answers.UseCovers = Read-YesNo 'Q4. Enable book-cover generation? (ComfyUI, ~6 GB image)' $false

    # Q5: VPN scouting
    Write-Host ''
    $answers.UseVpn = Read-YesNo 'Q5. Enable VPN-routed scouting? (NordVPN / TorGuard for Amazon, Reddit scraping)' $false

    # Q6: Cloudflare tunnel token (only if public scope)
    $answers.CloudflareToken = ''
    if ($answers.AccessScope -eq 'public') {
        Write-Host ''
        Write-Host '  Q6. Cloudflare Tunnel Token' -ForegroundColor White
        Write-Host '       Create one at: https://one.dash.cloudflare.com/ → Networks → Tunnels → Create' -ForegroundColor Gray
        Write-Host '       Paste the token below, or press Enter to skip and configure later.' -ForegroundColor Gray
        $answers.CloudflareToken = (Read-Host '       Token').Trim()
    }

    return $answers
}

# ─── .env generation ───────────────────────────────────────────────────

function Get-ComposeProfiles {
    param($Answers)
    $profiles = @()
    if ($Answers.AccessScope -eq 'public') { $profiles += 'public' }
    if ($Answers.UseCovers)                { $profiles += 'covers' }
    if ($Answers.UseVpn)                   { $profiles += 'vpn' }
    return $profiles -join ','
}

function New-EnvFile {
    param([string]$Dir, $Answers)
    Write-Section 'Generating .env'

    $envPath = Join-Path $Dir '.env'
    if (Test-Path $envPath) {
        if (-not (Read-YesNo "  .env already exists at $envPath — overwrite?" $false)) {
            Write-Ok 'Keeping existing .env (skipping generation)'
            return
        }
    }

    $vaultKey     = New-RandomHex 32
    $apiKey       = New-RandomHex 32
    $workerSecret = New-RandomHex 24
    $webhookSec   = New-RandomHex 24
    $profiles     = Get-ComposeProfiles $Answers

    # Build CORS origins based on access scope.
    $corsOrigins = switch ($Answers.AccessScope) {
        'local'  { 'http://localhost:3847,http://localhost:5173,http://localhost:4000' }
        'lan'    { 'http://localhost:3847,http://localhost:5173,http://localhost:4000,http://*.local:3847' }
        'public' { 'http://localhost:3847,http://localhost:5173,http://localhost:4000' }  # user adds their own public domain below
    }

    # Read .env.sample for the comment headers, then layer in our values.
    $samplePath = Join-Path $Dir '.env.sample'
    if (-not (Test-Path $samplePath)) {
        throw ".env.sample missing from checkout — cannot generate .env."
    }

    $cliComment = @()
    if ($Answers.UseClaude) { $cliComment += '#   - Anthropic CLI:  run `claude login` on the host once' }
    if ($Answers.UseGemini) { $cliComment += '#   - Google CLI:     run `gemini login` on the host once' }
    if ($Answers.UseCodex)  { $cliComment += '#   - OpenAI CLI:     run `codex login` on the host once' }
    $cliBlock = if ($cliComment.Count -gt 0) { $cliComment -join "`n" } else { '#   (no CLI workers enabled)' }

    $envContent = @"
# ────────────────────────────────────────────────────────────────────────
# Perry environment — generated by install.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm')
# Access scope: $($Answers.AccessScope)   Profiles: $profiles
# ────────────────────────────────────────────────────────────────────────

# ── Master keys (random — keep these private) ──────────────────────────
PERRY_VAULT_KEY=$vaultKey
PERRY_API_KEY=$apiKey
PERRY_WORKER_SECRET=$workerSecret
PERRY_WEBHOOK_SECRET=$webhookSec

# ── Compose profile selection (what optional services start) ───────────
COMPOSE_PROFILES=$profiles

# ── CLI subscriptions you opted in to ──────────────────────────────────
# Auth state lives in your host's ~/.claude, ~/.gemini, ~/.codex dirs and
# is mounted into the perry-worker container at spawn time. To finish
# setup, run these on the host (once per CLI):
$cliBlock

# ── CORS — which origins may load the dashboard ────────────────────────
PERRY_CORS_ORIGINS=$corsOrigins

# ── Telemetry (anonymous, opt-out with =true) ──────────────────────────
PERRY_TELEMETRY_DISABLED=false

"@

    # Cloudflare Tunnel block — only if public scope
    if ($Answers.AccessScope -eq 'public') {
        $cfBlock = if ([string]::IsNullOrWhiteSpace($Answers.CloudflareToken)) {
            "# Paste your Cloudflare Tunnel Token here once you've created the tunnel.`n# See docs/cloudflare-tunnel.md for the step-by-step guide.`nCLOUDFLARE_TUNNEL_TOKEN="
        } else {
            "CLOUDFLARE_TUNNEL_TOKEN=$($Answers.CloudflareToken)"
        }
        $envContent += @"

# ── Cloudflare Tunnel (public access) ──────────────────────────────────
$cfBlock

"@
    }

    # VPN scouting placeholders — only if VPN enabled
    if ($Answers.UseVpn) {
        $envContent += @"

# ── VPN scouting credentials (fill in if/when you sign up) ─────────────
# TorGuard WireGuard — UK + US static IPs (Reddit/Amazon allow-listable).
# See perry/scout/README.md for how to extract keys from TorGuard.
TG_WG_UK_ENDPOINT_IP=
TG_WG_UK_ENDPOINT_PORT=
TG_WG_UK_PRIVATE_KEY=
TG_WG_UK_PUBLIC_KEY=
TG_WG_UK_ADDRESSES=
TG_WG_US_ENDPOINT_IP=
TG_WG_US_ENDPOINT_PORT=
TG_WG_US_PRIVATE_KEY=
TG_WG_US_PUBLIC_KEY=
TG_WG_US_ADDRESSES=
# NordVPN WireGuard (used by gluetun-uk/de/us containers).
NORDVPN_WG_PRIVATE_KEY=

"@
    }

    # External data sources — always include but blank by default.
    $envContent += @"

# ── External data sources (optional) ───────────────────────────────────
# Reddit OAuth — without this, Reddit fetches fall back to proxy routing.
# Register a "script" app at https://www.reddit.com/prefs/apps.
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=perry-bookbot/1.0

# Google Books API — 1k queries/day free. Powers the Comp Title Scout's
# Google Books slot. Restricted to Books API in Google Cloud Console.
GOOGLE_BOOKS_API_KEY=

"@

    Set-Content -Path $envPath -Value $envContent -Encoding UTF8
    Write-Ok ".env written ($envPath)"
    Write-Ok "  PERRY_API_KEY = $apiKey"
    Write-Ok "  Compose profiles: $(if ($profiles) { $profiles } else { '(none — local minimum stack)' })"
}

# ─── Bring up the stack ────────────────────────────────────────────────

function Start-Stack {
    param([string]$Dir)
    Write-Section 'Starting the stack'
    Push-Location $Dir
    try {
        Write-Step 'docker compose up -d (this builds images on first run — 3-5 min)'
        docker compose up -d
        if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }
        Write-Ok 'Containers started'
    } finally {
        Pop-Location
    }
}

function Wait-PerryHealthy {
    Write-Section 'Waiting for Perry to come online'
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://localhost:3847/api/system/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($resp.StatusCode -eq 200 -or $resp.StatusCode -eq 401) {
                # 401 means perry is up but our request was unauthenticated — that's fine.
                Write-Ok 'Perry dashboard is responding'
                return $true
            }
        } catch {
            # Not up yet — quiet retry.
        }
        Start-Sleep -Seconds 3
        Write-Host '.' -NoNewline -ForegroundColor Gray
    }
    Write-Host ''
    Write-Warn 'Perry did not respond within 3 min. Check `docker compose logs perry` for errors.'
    return $false
}

# ─── Summary ───────────────────────────────────────────────────────────

function Write-Summary {
    param([string]$Dir, $Answers, [bool]$Healthy)
    Write-Section 'Setup complete'

    $envPath = Join-Path $Dir '.env'
    $apiKey = (Get-Content $envPath | Where-Object { $_ -match '^PERRY_API_KEY=' }) -replace '^PERRY_API_KEY=', ''

    Write-Host ''
    Write-Host '  Dashboard URL:' -ForegroundColor White
    Write-Host '    http://localhost:3847' -ForegroundColor Cyan
    if ($Answers.AccessScope -eq 'public' -and -not [string]::IsNullOrWhiteSpace($Answers.CloudflareToken)) {
        Write-Host '    (also reachable at your Cloudflare Tunnel hostname once DNS propagates)' -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host '  PERRY_API_KEY (paste this into the dashboard when prompted):' -ForegroundColor White
    Write-Host "    $apiKey" -ForegroundColor Cyan
    Write-Host ''

    $nextSteps = @()
    if ($Answers.UseClaude) { $nextSteps += '  - Run `claude login` on this host to bind your Anthropic Pro / Max subscription' }
    if ($Answers.UseGemini) { $nextSteps += '  - Run `gemini login` on this host to bind your Google Advanced subscription' }
    if ($Answers.UseCodex)  { $nextSteps += '  - Run `codex login` on this host to bind your ChatGPT Plus / Pro subscription' }
    if ($Answers.AccessScope -eq 'public' -and [string]::IsNullOrWhiteSpace($Answers.CloudflareToken)) {
        $nextSteps += '  - Create a Cloudflare Tunnel and paste the token into .env, then `docker compose up -d cloudflared`'
        $nextSteps += '  - Step-by-step: docs/cloudflare-tunnel.md'
    }
    if ($Answers.UseVpn) {
        $nextSteps += '  - Fill in TG_WG_* / NORDVPN_WG_PRIVATE_KEY values in .env, then restart the gluetun-* containers'
    }

    if ($nextSteps.Count -gt 0) {
        Write-Host '  Next steps:' -ForegroundColor White
        foreach ($step in $nextSteps) { Write-Host $step -ForegroundColor Gray }
        Write-Host ''
    }

    Write-Host '  Quick checks:' -ForegroundColor White
    Write-Host '    docker compose ps              # see what is running' -ForegroundColor Gray
    Write-Host '    docker compose logs -f perry   # tail perry logs' -ForegroundColor Gray
    Write-Host "    cat $envPath" -ForegroundColor Gray
    Write-Host ''

    if (-not $Healthy) {
        Write-Warn 'Health check timed out — Perry may still be starting. Run `docker compose logs perry` if it does not come up.'
    }

    # Persist the summary so users can re-read it later.
    $summaryPath = Join-Path $Dir 'setup-summary.txt'
    @"
Perry install — $(Get-Date -Format 'yyyy-MM-dd HH:mm')

Dashboard:    http://localhost:3847
PERRY_API_KEY: $apiKey

Access scope: $($Answers.AccessScope)
Profiles:     $(Get-ComposeProfiles $Answers)
CLIs:         $((@(if ($Answers.UseClaude) {'Anthropic'}; if ($Answers.UseGemini) {'Google'}; if ($Answers.UseCodex) {'OpenAI'}) -join ', '))

Next steps:
$($nextSteps -join "`n")

Quick checks:
  docker compose ps
  docker compose logs -f perry
"@ | Set-Content -Path $summaryPath -Encoding UTF8

    Write-Ok "Summary saved to $summaryPath"
}

# ─── Main ──────────────────────────────────────────────────────────────

try {
    Write-Banner
    Test-Prerequisites
    $dir = Get-InstallDirectory
    Initialize-Checkout -Dir $dir
    $answers = Invoke-Wizard
    New-EnvFile -Dir $dir -Answers $answers
    Start-Stack -Dir $dir
    $healthy = Wait-PerryHealthy
    Write-Summary -Dir $dir -Answers $answers -Healthy $healthy
    Write-Host '  Done.' -ForegroundColor Green
    Write-Host ''
} catch {
    Write-Host ''
    Write-Fail $_.Exception.Message
    Write-Host '  Installer aborted. The repo (if cloned) is left on disk for inspection.' -ForegroundColor Gray
    exit 1
}
