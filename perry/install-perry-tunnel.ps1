# install-perry-tunnel.ps1
#
# One-shot Cloudflare Tunnel setup for the Perry system. Mirrors the cribops
# `cribops-cli setup --cloudflare-tunnel` pattern: takes a Cloudflare API
# token, creates (or reuses) a remotely-managed tunnel, registers a
# subdomain CNAME, writes the tunnel token to .env, and optionally starts
# the cloudflared container.
#
# Usage (run from anywhere; the script anchors paths to its own location):
#   .\perry\install-perry-tunnel.ps1 -CloudflareApiToken cf-xxx
#   .\perry\install-perry-tunnel.ps1 -CloudflareApiToken cf-xxx -Subdomain hooks
#   .\perry\install-perry-tunnel.ps1 -CloudflareApiToken cf-xxx -StartContainer
#
# Required Cloudflare API token scopes:
#   - Account → Cloudflare Tunnel → Edit
#   - Zone   → DNS → Edit
#   - Account → Account Settings → Read   (to list accounts)
#   - Zone   → Zone → Read                 (to find the zone ID)
#
# Idempotent: re-running with the same subdomain replaces the existing
# ingress rule + DNS record rather than erroring.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CloudflareApiToken,

    [string]$Domain        = '5216perry.uk',
    [string]$Subdomain     = 'perry',
    [string]$TunnelName    = 'perry-system',
    [string]$ServiceUrl    = 'http://perry:3847',
    [switch]$StartContainer
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot  = Split-Path -Parent $scriptDir
$envPath   = Join-Path $repoRoot '.env'
$composePath = Join-Path $repoRoot 'compose.yaml'

$hostname = "$Subdomain.$Domain"

Write-Host ""
Write-Host "Perry Cloudflare Tunnel Installer" -ForegroundColor Cyan
Write-Host "----------------------------------" -ForegroundColor Cyan
Write-Host "Tunnel name : $TunnelName"
Write-Host "Hostname    : $hostname"
Write-Host "Service URL : $ServiceUrl"
Write-Host "Repo root   : $repoRoot"
Write-Host ""

$apiBase = 'https://api.cloudflare.com/client/v4'
$headers = @{
    'Authorization' = "Bearer $CloudflareApiToken"
    'Content-Type'  = 'application/json'
}

function Invoke-CF {
    param([string]$Method, [string]$Path, $Body)
    $url = "$apiBase$Path"
    $params = @{ Uri = $url; Method = $Method; Headers = $headers }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
    try {
        $res = Invoke-RestMethod @params
    } catch {
        $msg = $_.Exception.Message
        try {
            $errResp = $_.ErrorDetails.Message
            if ($errResp) { $msg = "$msg`n  CF says: $errResp" }
        } catch {}
        throw "Cloudflare API $Method $Path failed: $msg"
    }
    if (-not $res.success) {
        $errs = ($res.errors | ForEach-Object { "$($_.code): $($_.message)" }) -join '; '
        throw "Cloudflare API $Method $Path returned errors: $errs"
    }
    return $res
}

# ── 1. Verify token & find account ─────────────────────────────────────────
Write-Host "[1/6] Verifying API token..." -ForegroundColor Yellow
$verify = Invoke-CF -Method GET -Path '/user/tokens/verify'
Write-Host "      Token status: $($verify.result.status)" -ForegroundColor Green

Write-Host "[2/6] Resolving account..." -ForegroundColor Yellow
$accounts = Invoke-CF -Method GET -Path '/accounts'
if ($accounts.result.Count -eq 0) { throw "No accounts visible to this token." }
$accountId = $accounts.result[0].id
$accountName = $accounts.result[0].name
Write-Host "      Account: $accountName ($accountId)" -ForegroundColor Green

# ── 2. Find the zone for the domain ────────────────────────────────────────
Write-Host "[3/6] Looking up zone '$Domain'..." -ForegroundColor Yellow
$zones = Invoke-CF -Method GET -Path "/zones?name=$Domain"
if ($zones.result.Count -eq 0) {
    throw "Zone '$Domain' not found in this account. Add the domain to Cloudflare first."
}
$zoneId = $zones.result[0].id
Write-Host "      Zone: $Domain ($zoneId)" -ForegroundColor Green

# ── 3. Find or create the tunnel ───────────────────────────────────────────
Write-Host "[4/6] Resolving tunnel '$TunnelName'..." -ForegroundColor Yellow
$tunnels = Invoke-CF -Method GET -Path "/accounts/$accountId/cfd_tunnel?name=$TunnelName&is_deleted=false"
if ($tunnels.result.Count -gt 0) {
    $tunnelId = $tunnels.result[0].id
    Write-Host "      Tunnel exists: $TunnelName ($tunnelId)" -ForegroundColor Green
} else {
    # tunnel_secret must be 32+ bytes base64; remotely-managed tunnels still want one
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $tunnelSecret = [Convert]::ToBase64String($bytes)
    $create = Invoke-CF -Method POST -Path "/accounts/$accountId/cfd_tunnel" -Body @{
        name           = $TunnelName
        tunnel_secret  = $tunnelSecret
        config_src     = 'cloudflare'  # remotely-managed (dashboard/API)
    }
    $tunnelId = $create.result.id
    Write-Host "      Created tunnel: $TunnelName ($tunnelId)" -ForegroundColor Green
}

# ── 4. Get connector token + write to .env ─────────────────────────────────
Write-Host "[5/6] Fetching connector token + writing .env..." -ForegroundColor Yellow
$tokenRes = Invoke-CF -Method GET -Path "/accounts/$accountId/cfd_tunnel/$tunnelId/token"
$tunnelToken = $tokenRes.result
if (-not $tunnelToken) { throw "Failed to retrieve tunnel connector token." }

# Upsert CLOUDFLARE_TUNNEL_TOKEN in .env
$envLines = if (Test-Path $envPath) { Get-Content $envPath } else { @() }
$envLines = $envLines | Where-Object { $_ -notmatch '^CLOUDFLARE_TUNNEL_TOKEN=' }
$envLines += "CLOUDFLARE_TUNNEL_TOKEN=$tunnelToken"
Set-Content -Path $envPath -Value $envLines -Encoding UTF8
Write-Host "      Wrote CLOUDFLARE_TUNNEL_TOKEN to $envPath" -ForegroundColor Green

# ── 5. Set tunnel ingress + create CNAME ───────────────────────────────────
Write-Host "[6/6] Setting ingress rule + DNS record..." -ForegroundColor Yellow

# Pull current config, merge our hostname in (preserves other hostnames on the tunnel)
$currentConfig = Invoke-CF -Method GET -Path "/accounts/$accountId/cfd_tunnel/$tunnelId/configurations"
$ingress = @()
if ($currentConfig.result.config.ingress) {
    $ingress = @($currentConfig.result.config.ingress | Where-Object { $_.hostname -ne $hostname -and $_.service -ne 'http_status:404' })
}
$ingress += [ordered]@{ hostname = $hostname; service = $ServiceUrl }
$ingress += [ordered]@{ service  = 'http_status:404' }   # catch-all

Invoke-CF -Method PUT -Path "/accounts/$accountId/cfd_tunnel/$tunnelId/configurations" -Body @{
    config = @{ ingress = $ingress }
} | Out-Null
Write-Host "      Ingress: $hostname -> $ServiceUrl" -ForegroundColor Green

# CNAME: $Subdomain.$Domain  ->  $tunnelId.cfargotunnel.com (proxied)
$dnsTarget = "$tunnelId.cfargotunnel.com"
$existingDns = Invoke-CF -Method GET -Path "/zones/$zoneId/dns_records?name=$hostname"
if ($existingDns.result.Count -gt 0) {
    $recId = $existingDns.result[0].id
    Invoke-CF -Method PUT -Path "/zones/$zoneId/dns_records/$recId" -Body @{
        type    = 'CNAME'
        name    = $hostname
        content = $dnsTarget
        proxied = $true
        ttl     = 1
    } | Out-Null
    Write-Host "      Updated existing CNAME: $hostname -> $dnsTarget" -ForegroundColor Green
} else {
    Invoke-CF -Method POST -Path "/zones/$zoneId/dns_records" -Body @{
        type    = 'CNAME'
        name    = $hostname
        content = $dnsTarget
        proxied = $true
        ttl     = 1
    } | Out-Null
    Write-Host "      Created CNAME: $hostname -> $dnsTarget" -ForegroundColor Green
}

# ── 6. Optionally start the cloudflared container ─────────────────────────
Write-Host ""
Write-Host "All set." -ForegroundColor Cyan
Write-Host "  Hostname: https://$hostname"
Write-Host "  Tunnel:   $TunnelName ($tunnelId)"
Write-Host ""

if ($StartContainer) {
    Write-Host "Starting cloudflared container..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
        docker compose up -d cloudflared
    } finally {
        Pop-Location
    }
    Write-Host ""
    Write-Host "Wait ~20s, then test:" -ForegroundColor Cyan
    Write-Host "  curl https://$hostname/api/pens"
} else {
    Write-Host "Next step (run from $repoRoot):" -ForegroundColor Cyan
    Write-Host "  docker compose up -d cloudflared"
    Write-Host ""
    Write-Host "Then test:" -ForegroundColor Cyan
    Write-Host "  curl https://$hostname/api/pens"
}
