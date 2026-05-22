#!/usr/bin/env bash
# Perry one-shot installer for Linux / macOS. Mirror of install.ps1.
#
# Invoke as:
#   curl -fsSL https://perry.5216perry.uk/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Perry5216/perry-system/main/install.sh | bash
#
# Asks 6 questions, then clones Perry5216/perry-system, generates a .env
# with random secrets, picks the right COMPOSE_PROFILES, runs
# `docker compose up -d`, and waits for the dashboard to come online.
#
# Subscription-only design: never collects metered API keys. Workers use
# the operator's existing CLI subscriptions (Claude Pro/Max, Gemini
# Advanced, ChatGPT Plus/Pro) via host-mounted OAuth dirs.

set -euo pipefail

REPO_URL='https://github.com/Perry5216/perry-system.git'

# ─── Console rendering ─────────────────────────────────────────────────

# Detect TTY for color output. When piped through `bash` from a terminal,
# stdin is the pipe but stdout is still the terminal — colour on stdout
# is safe to enable.
if [[ -t 1 ]]; then
    C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
    C_RED=$'\033[31m'; C_GRAY=$'\033[90m'; C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
else
    C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_GRAY=''; C_RESET=''; C_BOLD=''
fi

banner() {
    echo
    echo "${C_CYAN}  ╔═══════════════════════════════════════════════════════════════╗${C_RESET}"
    echo "${C_CYAN}  ║                                                               ║${C_RESET}"
    echo "${C_CYAN}  ║   P.E.R.R.Y.  —  Self-hosted multi-agent AI platform          ║${C_RESET}"
    echo "${C_CYAN}  ║   Prose · Evaluation · Research · Revision Engine             ║${C_RESET}"
    echo "${C_CYAN}  ║                                                               ║${C_RESET}"
    echo "${C_CYAN}  ╚═══════════════════════════════════════════════════════════════╝${C_RESET}"
    echo
    echo "${C_GRAY}  This installer asks a handful of questions, generates a tailored${C_RESET}"
    echo "${C_GRAY}  .env and compose profile set, then brings up the stack. Takes${C_RESET}"
    echo "${C_GRAY}  3-5 minutes after the questions are answered.${C_RESET}"
    echo
}

section() { echo; printf '%s─── %s %s%s\n' "$C_CYAN" "$1" "$(printf '─%.0s' $(seq 1 $((60 - ${#1}))))" "$C_RESET"; }
step()    { printf '  → %s\n' "$1"; }
ok()      { printf '%s  ✓ %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
warn()    { printf '%s  ! %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
fail()    { printf '%s  ✗ %s%s\n' "$C_RED" "$1" "$C_RESET"; }

# ─── Input helpers ─────────────────────────────────────────────────────
# IMPORTANT: when this script is run via `curl | bash`, stdin is the
# piped script body, not the user's TTY. Read prompts from /dev/tty so
# the wizard works.

read_tty() {
    # $1 = prompt   $2 = default   echoes user response
    local prompt="$1" default="$2" resp
    if [[ -n "$default" ]]; then
        printf '  %s [%s]: ' "$prompt" "$default" >&2
    else
        printf '  %s: ' "$prompt" >&2
    fi
    if [[ -e /dev/tty ]]; then
        read -r resp < /dev/tty
    else
        read -r resp
    fi
    if [[ -z "$resp" ]]; then resp="$default"; fi
    echo "$resp"
}

read_yesno() {
    # $1 = prompt   $2 = default (y or n)   sets REPLY to 'y' or 'n'
    local prompt="$1" default="$2" hint
    hint=$([[ "$default" = 'y' ]] && echo 'Y/n' || echo 'y/N')
    while true; do
        local resp
        resp="$(read_tty "$prompt" "$hint")"
        case "$resp" in
            [yY]*|'Y/n') REPLY='y'; return ;;
            [nN]*|'y/N') REPLY='n'; return ;;
            *) warn 'Please answer y or n.' ;;
        esac
    done
}

read_choice() {
    # $1 = prompt; remaining args = options. Sets REPLY to 0-based index.
    local prompt="$1"; shift
    local opts=("$@")
    echo
    echo "  $prompt" >&2
    local i=0
    for opt in "${opts[@]}"; do
        printf '    [%d]  %s\n' "$((i+1))" "$opt" >&2
        i=$((i+1))
    done
    while true; do
        local resp
        resp="$(read_tty "Choice (1-${#opts[@]})" '1')"
        if [[ "$resp" =~ ^[0-9]+$ ]] && (( resp >= 1 && resp <= ${#opts[@]} )); then
            REPLY=$((resp - 1)); return
        fi
        warn "Please enter a number between 1 and ${#opts[@]}."
    done
}

rand_hex() {
    # $1 = byte count. Uses OpenSSL if present, falls back to /dev/urandom.
    local n="$1"
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$n"
    else
        head -c "$n" /dev/urandom | xxd -p -c 256
    fi
}

# ─── Prerequisite checks ───────────────────────────────────────────────

check_prerequisites() {
    section 'Checking prerequisites'
    local issues=()

    if ! command -v docker >/dev/null 2>&1; then
        issues+=("Docker is not installed. Install from https://docs.docker.com/engine/install/")
    else
        ok 'docker found'
        if ! docker info >/dev/null 2>&1; then
            issues+=("Docker is installed but the daemon is not running. Start Docker Desktop / dockerd.")
        else
            ok 'docker daemon is running'
        fi
    fi

    if ! command -v git >/dev/null 2>&1; then
        issues+=("git is not installed. Install via your package manager (apt / brew / etc).")
    else
        ok 'git found'
    fi

    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
        ok 'NVIDIA GPU detected'
    else
        warn 'No NVIDIA GPU detected — ollama / comfyui containers expect CUDA.'
        warn 'You can still install, but the local LLM stack will fail to start.'
    fi

    if (( ${#issues[@]} > 0 )); then
        echo
        for issue in "${issues[@]}"; do fail "$issue"; done
        exit 1
    fi
}

# ─── Install directory + clone ─────────────────────────────────────────

choose_install_dir() {
    section 'Install location' >&2
    local default="$(pwd)/perry-system"
    local resp
    resp="$(read_tty 'Install directory' "$default")"
    # Resolve to absolute
    case "$resp" in
        /*) echo "$resp" ;;
        *)  echo "$(pwd)/$resp" ;;
    esac
}

initialize_checkout() {
    local dir="$1"
    section 'Cloning the repository'
    if [[ -d "$dir" ]]; then
        if [[ -d "$dir/.git" ]]; then
            warn "Existing checkout found at $dir"
            read_yesno 'Skip clone and reuse existing checkout?' 'y'
            if [[ "$REPLY" = 'y' ]]; then ok "Reusing $dir"; return; fi
        fi
        if [[ -n "$(ls -A "$dir" 2>/dev/null)" ]]; then
            fail "Directory $dir exists and is not empty. Delete it or choose another location."
            exit 1
        fi
    else
        mkdir -p "$dir"
    fi
    step "git clone $REPO_URL $dir"
    git clone "$REPO_URL" "$dir"
    ok 'Repository cloned'
}

# ─── Wizard ────────────────────────────────────────────────────────────
# Wizard answers live in plain global vars (bash doesn't have nice maps
# across function returns). Prefixed A_ for clarity.

run_wizard() {
    section 'Configuration wizard'
    echo "${C_GRAY}  Answer 6 questions. Defaults are marked with the first option.${C_RESET}"

    # Q1
    read_choice 'Q1. Who needs to reach Perry'"'"'s dashboard?' \
        'Local-only — just this machine (http://localhost:3847)' \
        'LAN — other devices on your network' \
        'Public — anywhere on the internet via Cloudflare Tunnel'
    A_SCOPE=$([[ "$REPLY" = 0 ]] && echo 'local' || ([[ "$REPLY" = 1 ]] && echo 'lan' || echo 'public'))

    # Q2 — multi-select
    echo
    echo '  Q2. Which subscription CLIs do you want to enable as workers?'
    echo "${C_GRAY}       (multi-select — at least one is recommended for non-trivial tasks)${C_RESET}"
    read_yesno '       Anthropic CLI (Pro / Max plan)?' 'y'; A_CLAUDE="$REPLY"
    read_yesno '       Google Gemini CLI (Advanced plan)?' 'y'; A_GEMINI="$REPLY"
    read_yesno '       OpenAI Codex CLI (ChatGPT Plus / Pro / Business plan)?' 'n'; A_CODEX="$REPLY"
    if [[ "$A_CLAUDE" = 'n' && "$A_GEMINI" = 'n' && "$A_CODEX" = 'n' ]]; then
        warn 'No CLIs selected — Perry will only do local-model work (limited).'
    fi

    # Q3
    read_choice 'Q3. GPU layout?' \
        'Single GPU (everything shares one card)' \
        'Dual GPU (writer on GPU 0, librarian/embeddings on GPU 1)'
    A_DUAL_GPU=$([[ "$REPLY" = 1 ]] && echo 'y' || echo 'n')

    # Q4
    echo
    read_yesno 'Q4. Enable book-cover generation? (ComfyUI, ~6 GB image)' 'n'; A_COVERS="$REPLY"

    # Q5
    echo
    read_yesno 'Q5. Enable VPN-routed scouting? (NordVPN / TorGuard for Amazon, Reddit scraping)' 'n'; A_VPN="$REPLY"

    # Q6
    A_CF_TOKEN=''
    if [[ "$A_SCOPE" = 'public' ]]; then
        echo
        echo '  Q6. Cloudflare Tunnel Token'
        echo "${C_GRAY}       Create one at: https://one.dash.cloudflare.com/ → Networks → Tunnels → Create${C_RESET}"
        echo "${C_GRAY}       Paste the token below, or press Enter to skip and configure later.${C_RESET}"
        A_CF_TOKEN="$(read_tty 'Token' '')"
    fi
}

compose_profiles() {
    local p=()
    [[ "$A_SCOPE" = 'public' ]] && p+=('public')
    [[ "$A_COVERS" = 'y' ]]     && p+=('covers')
    [[ "$A_VPN" = 'y' ]]        && p+=('vpn')
    local IFS=','; echo "${p[*]:-}"
}

# ─── .env generation ──────────────────────────────────────────────────

generate_env() {
    local dir="$1"
    section 'Generating .env'

    local env_path="$dir/.env"
    if [[ -f "$env_path" ]]; then
        read_yesno ".env already exists at $env_path — overwrite?" 'n'
        if [[ "$REPLY" = 'n' ]]; then ok 'Keeping existing .env (skipping generation)'; return; fi
    fi

    local vault_key api_key worker_secret webhook_secret profiles
    vault_key="$(rand_hex 32)"
    api_key="$(rand_hex 32)"
    worker_secret="$(rand_hex 24)"
    webhook_secret="$(rand_hex 24)"
    profiles="$(compose_profiles)"

    local cors
    case "$A_SCOPE" in
        local)  cors='http://localhost:3847,http://localhost:5173,http://localhost:4000' ;;
        lan)    cors='http://localhost:3847,http://localhost:5173,http://localhost:4000,http://*.local:3847' ;;
        public) cors='http://localhost:3847,http://localhost:5173,http://localhost:4000' ;;
    esac

    local cli_block=''
    [[ "$A_CLAUDE" = 'y' ]] && cli_block+='#   - Anthropic CLI:  run `claude login` on the host once'$'\n'
    [[ "$A_GEMINI" = 'y' ]] && cli_block+='#   - Google CLI:     run `gemini login` on the host once'$'\n'
    [[ "$A_CODEX"  = 'y' ]] && cli_block+='#   - OpenAI CLI:     run `codex login` on the host once'$'\n'
    [[ -z "$cli_block" ]]   && cli_block='#   (no CLI workers enabled)'$'\n'

    {
        cat <<EOF
# ────────────────────────────────────────────────────────────────────────
# Perry environment — generated by install.sh on $(date '+%Y-%m-%d %H:%M')
# Access scope: $A_SCOPE   Profiles: $profiles
# ────────────────────────────────────────────────────────────────────────

# ── Master keys (random — keep these private) ──────────────────────────
PERRY_VAULT_KEY=$vault_key
PERRY_API_KEY=$api_key
PERRY_WORKER_SECRET=$worker_secret
PERRY_WEBHOOK_SECRET=$webhook_secret

# ── Compose profile selection (what optional services start) ───────────
COMPOSE_PROFILES=$profiles

# ── CLI subscriptions you opted in to ──────────────────────────────────
# Auth state lives in your host's ~/.claude, ~/.gemini, ~/.codex dirs and
# is mounted into the perry-worker container at spawn time. To finish
# setup, run these on the host (once per CLI):
$cli_block
# ── CORS — which origins may load the dashboard ────────────────────────
PERRY_CORS_ORIGINS=$cors

# ── Telemetry (anonymous, opt-out with =true) ──────────────────────────
PERRY_TELEMETRY_DISABLED=false

EOF

        if [[ "$A_SCOPE" = 'public' ]]; then
            echo
            echo '# ── Cloudflare Tunnel (public access) ──────────────────────────────────'
            if [[ -n "$A_CF_TOKEN" ]]; then
                echo "CLOUDFLARE_TUNNEL_TOKEN=$A_CF_TOKEN"
            else
                echo '# Paste your Cloudflare Tunnel Token here once you'"'"'ve created the tunnel.'
                echo '# See docs/cloudflare-tunnel.md for the step-by-step guide.'
                echo 'CLOUDFLARE_TUNNEL_TOKEN='
            fi
            echo
        fi

        if [[ "$A_VPN" = 'y' ]]; then
            cat <<'EOF'

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

EOF
        fi

        cat <<'EOF'

# ── External data sources (optional) ───────────────────────────────────
# Reddit OAuth — without this, Reddit fetches fall back to proxy routing.
# Register a "script" app at https://www.reddit.com/prefs/apps.
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=perry-bookbot/1.0

# Google Books API — 1k queries/day free. Powers the Comp Title Scout's
# Google Books slot. Restricted to Books API in Google Cloud Console.
GOOGLE_BOOKS_API_KEY=
EOF
    } > "$env_path"

    ok ".env written ($env_path)"
    ok "  PERRY_API_KEY = $api_key"
    if [[ -n "$profiles" ]]; then
        ok "  Compose profiles: $profiles"
    else
        ok '  Compose profiles: (none — local minimum stack)'
    fi
}

# ─── Bring up the stack ───────────────────────────────────────────────

start_stack() {
    local dir="$1"
    section 'Starting the stack'
    cd "$dir"
    step 'docker compose up -d (this builds images on first run — 3-5 min)'
    docker compose up -d
    ok 'Containers started'
}

wait_perry_healthy() {
    section 'Waiting for Perry to come online'
    local deadline=$(( $(date +%s) + 180 ))
    while (( $(date +%s) < deadline )); do
        if curl -s -o /dev/null -m 3 -w '%{http_code}' http://localhost:3847/api/system/health 2>/dev/null | grep -qE '^(200|401)$'; then
            ok 'Perry dashboard is responding'
            return 0
        fi
        printf '%s.%s' "$C_GRAY" "$C_RESET"
        sleep 3
    done
    echo
    warn 'Perry did not respond within 3 min. Check `docker compose logs perry` for errors.'
    return 1
}

# ─── Summary ──────────────────────────────────────────────────────────

write_summary() {
    local dir="$1" healthy="$2"
    section 'Setup complete'

    local api_key
    api_key="$(grep -E '^PERRY_API_KEY=' "$dir/.env" | head -1 | cut -d= -f2-)"

    echo
    echo '  Dashboard URL:'
    echo "    ${C_CYAN}http://localhost:3847${C_RESET}"
    if [[ "$A_SCOPE" = 'public' && -n "$A_CF_TOKEN" ]]; then
        echo "${C_GRAY}    (also reachable at your Cloudflare Tunnel hostname once DNS propagates)${C_RESET}"
    fi
    echo
    echo '  PERRY_API_KEY (paste this into the dashboard when prompted):'
    echo "    ${C_CYAN}$api_key${C_RESET}"
    echo

    local steps=()
    [[ "$A_CLAUDE" = 'y' ]] && steps+=('  - Run `claude login` on this host to bind your Anthropic Pro / Max subscription')
    [[ "$A_GEMINI" = 'y' ]] && steps+=('  - Run `gemini login` on this host to bind your Google Advanced subscription')
    [[ "$A_CODEX"  = 'y' ]] && steps+=('  - Run `codex login` on this host to bind your ChatGPT Plus / Pro subscription')
    if [[ "$A_SCOPE" = 'public' && -z "$A_CF_TOKEN" ]]; then
        steps+=('  - Create a Cloudflare Tunnel and paste the token into .env, then `docker compose up -d cloudflared`')
        steps+=('  - Step-by-step: docs/cloudflare-tunnel.md')
    fi
    [[ "$A_VPN" = 'y' ]] && steps+=('  - Fill in TG_WG_* / NORDVPN_WG_PRIVATE_KEY values in .env, then restart the gluetun-* containers')

    if (( ${#steps[@]} > 0 )); then
        echo '  Next steps:'
        for s in "${steps[@]}"; do printf '%s%s%s\n' "$C_GRAY" "$s" "$C_RESET"; done
        echo
    fi

    echo '  Quick checks:'
    echo "${C_GRAY}    docker compose ps              # see what is running${C_RESET}"
    echo "${C_GRAY}    docker compose logs -f perry   # tail perry logs${C_RESET}"
    echo "${C_GRAY}    cat $dir/.env${C_RESET}"
    echo

    [[ "$healthy" = '1' ]] || warn 'Health check timed out — Perry may still be starting.'

    # Persist summary
    {
        echo "Perry install — $(date '+%Y-%m-%d %H:%M')"
        echo
        echo 'Dashboard:    http://localhost:3847'
        echo "PERRY_API_KEY: $api_key"
        echo
        echo "Access scope: $A_SCOPE"
        echo "Profiles:     $(compose_profiles)"
        local clis=()
        [[ "$A_CLAUDE" = 'y' ]] && clis+=('Anthropic')
        [[ "$A_GEMINI" = 'y' ]] && clis+=('Google')
        [[ "$A_CODEX"  = 'y' ]] && clis+=('OpenAI')
        local IFS=', '; echo "CLIs:         ${clis[*]:-(none)}"
        echo
        echo 'Next steps:'
        for s in "${steps[@]}"; do echo "$s"; done
        echo
        echo 'Quick checks:'
        echo '  docker compose ps'
        echo '  docker compose logs -f perry'
    } > "$dir/setup-summary.txt"
    ok "Summary saved to $dir/setup-summary.txt"
}

# ─── Main ──────────────────────────────────────────────────────────────

main() {
    banner
    check_prerequisites
    local dir
    dir="$(choose_install_dir)"
    initialize_checkout "$dir"
    run_wizard
    generate_env "$dir"
    start_stack "$dir"
    if wait_perry_healthy; then healthy=1; else healthy=0; fi
    write_summary "$dir" "$healthy"
    printf '%s  Done.%s\n\n' "$C_GREEN" "$C_RESET"
}

main "$@"
