# install-perry-access.ps1
#
# Sit-on-top companion to install-perry-tunnel.ps1: configures Cloudflare
# Access so the public tunnel hostname (default perry.5216perry.uk) is
# locked down to one human (browser → email login) plus a service-token
# pathway for machine callers (n8n / curl / MCP), AND leaves the webhook
# receiver path open so external services can still push events.
#
# Produces three Cloudflare resources:
#   1. "Perry webhooks" Access App - path /api/system/webhooks/* → BYPASS
#      Perry's own X-Webhook-Secret check is the auth on this path.
#   2. "Perry" Access App - everything else on perry.5216perry.uk
#      Policy A: owner email allowed (browser path)
#      Policy B: service token allowed (machine path)
#   3. "perry-machine-clients" Service Token - client_id + secret written
#      to .env as CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET.
#
# Usage:
#   .\perry\install-perry-access.ps1 -CloudflareApiToken cf-xxx -OwnerEmail you@example.com
#
# Required token scopes (on top of what install-perry-tunnel.ps1 needed):
#   - Account → Access: Apps and Policies → Edit
#   - Account → Access: Service Tokens → Edit
#   - Account → Account Settings → Read
#
# Idempotent: re-running with the same names updates existing resources
# rather than duplicating them.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CloudflareApiToken,

    [Parameter(Mandatory = $true)]
    [string]$OwnerEmail,

    [string]$Domain           = '5216perry.uk',
    [string]$Subdomain        = 'perry',
    [string]$AppName          = 'Perry',
    [string]$WebhookAppName   = 'Perry webhooks',
    [string]$ServiceTokenName = 'perry-machine-clients',
    [int]   $SessionHours     = 24
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot  = Split-Path -Parent $scriptDir
$envPath   = Join-Path $repoRoot '.env'

$hostname     = "$Subdomain.$Domain"
$webhookPath  = "$hostname/api/system/webhooks*"

Write-Host ""
Write-Host "Perry Cloudflare Access Installer" -ForegroundColor Cyan
Write-Host "----------------------------------" -ForegroundColor Cyan
Write-Host "Hostname     : $hostname"
Write-Host "Owner email  : $OwnerEmail"
Write-Host "App name     : $AppName"
Write-Host "Webhook app  : $WebhookAppName (path $webhookPath)"
Write-Host "Service tok  : $ServiceTokenName"
Write-Host "Session      : ${SessionHours}h"
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
        try { if ($_.ErrorDetails.Message) { $msg = "$msg`n  CF says: $($_.ErrorDetails.Message)" } } catch {}
        throw "Cloudflare API $Method $Path failed: $msg"
    }
    if (-not $res.success) {
        $errs = ($res.errors | ForEach-Object { "$($_.code): $($_.message)" }) -join '; '
        throw "Cloudflare API $Method $Path returned errors: $errs"
    }
    return $res
}

# ── 1. Verify token + find account ─────────────────────────────────────────
Write-Host "[1/7] Verifying API token..." -ForegroundColor Yellow
$verify = Invoke-CF -Method GET -Path '/user/tokens/verify'
Write-Host "      Token status: $($verify.result.status)" -ForegroundColor Green

Write-Host "[2/7] Resolving account..." -ForegroundColor Yellow
$accounts = Invoke-CF -Method GET -Path '/accounts'
if ($accounts.result.Count -eq 0) { throw "No accounts visible to this token." }
$accountId = $accounts.result[0].id
Write-Host "      Account: $($accounts.result[0].name) ($accountId)" -ForegroundColor Green

# ── 2. Service Token (machine clients) ─────────────────────────────────────
Write-Host "[3/7] Resolving service token '$ServiceTokenName'..." -ForegroundColor Yellow
$tokenList = Invoke-CF -Method GET -Path "/accounts/$accountId/access/service_tokens"
$existingToken = $tokenList.result | Where-Object { $_.name -eq $ServiceTokenName } | Select-Object -First 1

$clientId     = $null
$clientSecret = $null
$serviceTokenId = $null

if ($existingToken) {
    $serviceTokenId = $existingToken.id
    $clientId       = $existingToken.client_id
    Write-Host "      Service token exists: $ServiceTokenName ($serviceTokenId)" -ForegroundColor Green
    Write-Host "      NOTE: client_secret is only returned at creation; keeping existing .env value." -ForegroundColor DarkYellow
} else {
    $createTok = Invoke-CF -Method POST -Path "/accounts/$accountId/access/service_tokens" -Body @{
        name     = $ServiceTokenName
        duration = '8760h'   # 1 year
    }
    $serviceTokenId = $createTok.result.id
    $clientId       = $createTok.result.client_id
    $clientSecret   = $createTok.result.client_secret  # ONLY available at creation
    Write-Host "      Created service token: $ServiceTokenName ($serviceTokenId)" -ForegroundColor Green
}

# ── 3. Helper: find/create Access App ──────────────────────────────────────
function Get-OrCreateAccessApp {
    param([string]$Name, [string]$DomainSpec)

    $apps = Invoke-CF -Method GET -Path "/accounts/$accountId/access/apps"
    $existing = $apps.result | Where-Object { $_.name -eq $Name -and $_.domain -eq $DomainSpec } | Select-Object -First 1
    if ($existing) {
        Write-Host "      App exists: $Name ($($existing.id))" -ForegroundColor Green
        return $existing
    }
    $created = Invoke-CF -Method POST -Path "/accounts/$accountId/access/apps" -Body @{
        name             = $Name
        domain           = $DomainSpec
        type             = 'self_hosted'
        session_duration = "${SessionHours}h"
        app_launcher_visible = $true
    }
    Write-Host "      Created app: $Name ($($created.result.id))" -ForegroundColor Green
    return $created.result
}

# ── 4. Webhook-bypass app (path-scoped) ────────────────────────────────────
Write-Host "[4/7] Webhook bypass app at $webhookPath ..." -ForegroundColor Yellow
$webhookApp = Get-OrCreateAccessApp -Name $WebhookAppName -DomainSpec $webhookPath

# Replace its policies with a single Bypass rule.
$existingPols = Invoke-CF -Method GET -Path "/accounts/$accountId/access/apps/$($webhookApp.id)/policies"
foreach ($p in $existingPols.result) {
    Invoke-CF -Method DELETE -Path "/accounts/$accountId/access/apps/$($webhookApp.id)/policies/$($p.id)" | Out-Null
}
Invoke-CF -Method POST -Path "/accounts/$accountId/access/apps/$($webhookApp.id)/policies" -Body @{
    name      = 'Bypass for webhook receivers'
    decision  = 'bypass'
    include   = @(@{ everyone = @{} })
    precedence = 1
} | Out-Null
Write-Host "      Bypass policy applied (Perry's X-Webhook-Secret check still enforced inside the app)." -ForegroundColor Green

# ── 5. Main app (everything else under perry.<domain>) ─────────────────────
Write-Host "[5/7] Main Access app for $hostname ..." -ForegroundColor Yellow
$mainApp = Get-OrCreateAccessApp -Name $AppName -DomainSpec $hostname

# Wipe + recreate policies so re-runs are clean.
$existingPols = Invoke-CF -Method GET -Path "/accounts/$accountId/access/apps/$($mainApp.id)/policies"
foreach ($p in $existingPols.result) {
    Invoke-CF -Method DELETE -Path "/accounts/$accountId/access/apps/$($mainApp.id)/policies/$($p.id)" | Out-Null
}

# Policy A - owner email allowed (browser path, One-time PIN by default)
Invoke-CF -Method POST -Path "/accounts/$accountId/access/apps/$($mainApp.id)/policies" -Body @{
    name       = 'Owner only'
    decision   = 'allow'
    include    = @(@{ email = @{ email = $OwnerEmail } })
    precedence = 1
} | Out-Null
Write-Host "      Allow policy: $OwnerEmail" -ForegroundColor Green

# Policy B - service token allowed (machine path, no human login)
Invoke-CF -Method POST -Path "/accounts/$accountId/access/apps/$($mainApp.id)/policies" -Body @{
    name       = 'Machine clients'
    decision   = 'non_identity'
    include    = @(@{ service_token = @{ token_id = $serviceTokenId } })
    precedence = 2
} | Out-Null
Write-Host "      Non-identity policy: $ServiceTokenName" -ForegroundColor Green

# ── 6. Write service-token credentials to .env ─────────────────────────────
Write-Host "[6/7] Writing service-token credentials to $envPath ..." -ForegroundColor Yellow
$envLines = if (Test-Path $envPath) { Get-Content $envPath } else { @() }
$envLines = $envLines | Where-Object {
    $_ -notmatch '^CF_ACCESS_CLIENT_ID=' -and $_ -notmatch '^CF_ACCESS_CLIENT_SECRET='
}
$envLines += "CF_ACCESS_CLIENT_ID=$clientId"
if ($clientSecret) {
    $envLines += "CF_ACCESS_CLIENT_SECRET=$clientSecret"
} else {
    $envLines += "# CF_ACCESS_CLIENT_SECRET=<not regenerated - existing token re-used; rotate via dashboard if lost>"
}
Set-Content -Path $envPath -Value $envLines -Encoding UTF8
Write-Host "      .env updated." -ForegroundColor Green

# ── 7. Summary ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Done." -ForegroundColor Cyan
Write-Host ""
Write-Host "Access posture for $hostname" -ForegroundColor Cyan
Write-Host "----------------------------------" -ForegroundColor Cyan
Write-Host ("  Browser (you)      : Login via Cloudflare one-time-PIN to {0}" -f $OwnerEmail)
Write-Host  "  Webhooks           : Bypass at /api/system/webhooks/* (X-Webhook-Secret still enforced inside Perry)"
Write-Host  "  Machine clients    : Send headers"
Write-Host  "                         CF-Access-Client-Id:     $clientId"
if ($clientSecret) {
    Write-Host "                         CF-Access-Client-Secret: $clientSecret"
} else {
    Write-Host  "                         CF-Access-Client-Secret: <re-used existing - see Cloudflare dashboard>"
}
Write-Host ""
Write-Host "Smoke test (no creds - should now 302 to the Cloudflare login page):" -ForegroundColor Cyan
Write-Host "  curl -i https://$hostname/api/pens"
Write-Host ""
Write-Host "Machine test (with creds - should return JSON):" -ForegroundColor Cyan
Write-Host "  curl https://$hostname/api/pens \"
Write-Host "    -H `"CF-Access-Client-Id: $clientId`" \"
Write-Host "    -H `"CF-Access-Client-Secret: <secret>`""
Write-Host ""
Write-Host "Note: Perry's own PERRY_API_KEY is NOT set up by this script."        -ForegroundColor DarkYellow
Write-Host "If you want belt-and-braces app-layer auth on top of Access, run:"   -ForegroundColor DarkYellow
Write-Host '  $key = -join ((48..57)+(97..122) | Get-Random -Count 48 | %{[char]$_})'  -ForegroundColor DarkYellow
Write-Host '  Add-Content "d:/n8n/.env" "PERRY_API_KEY=$key"; docker compose up -d perry' -ForegroundColor DarkYellow
