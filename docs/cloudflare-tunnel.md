# Cloudflare Tunnel — public dashboard access

When you picked **Public** during `install.ps1` / `install.sh`, Perry's
compose stack was set up to start a `cloudflared` container (gated behind
the `public` profile). The container holds a Cloudflare Tunnel
connection that proxies the dashboard to a hostname you own — no port
forwarding, no inbound firewall holes, no static IP needed.

This doc walks through getting a working Tunnel Token from Cloudflare
and pasting it into your `.env`. ~5 minutes if you already have a domain
on Cloudflare; ~15 minutes if you don't.

## Prerequisites

- A Cloudflare account (free tier is fine).
- A domain whose DNS is managed by Cloudflare. If your domain is
  registered elsewhere, you can transfer DNS to Cloudflare for free —
  see [Cloudflare's onboarding guide](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).

## Create the tunnel

1. Sign in at https://one.dash.cloudflare.com/.
2. In the sidebar, open **Networks → Tunnels**.
3. Click **Create a tunnel**.
4. Pick **Cloudflared** as the connector type → **Next**.
5. Give the tunnel a name (e.g. `perry`) → **Save tunnel**.
6. On the **Install and run a connector** page, scroll past the OS
   choices — you don't need to install cloudflared on the host. Perry
   runs it in a container. What you need is the **Tunnel Token**: a
   long string starting with `eyJ...`. Copy it.

## Wire the token into Perry

1. Open `.env` in the install directory.
2. Find the `CLOUDFLARE_TUNNEL_TOKEN=` line (the installer leaves it
   blank if you skipped pasting during setup) and paste the token after
   the `=`.
3. Save the file. No quotes, no spaces — just the raw token.

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYTBlYTQ4...long string...0123
```

## Add a public hostname → dashboard route

Back in the Cloudflare Tunnel UI:

1. Click **Next** on the connector page (no install needed — we'll
   start the container next).
2. On the **Add a public hostname** page:
   - **Subdomain:** pick whatever you want (e.g. `perry`)
   - **Domain:** pick your Cloudflare-managed domain
   - **Service Type:** `HTTP`
   - **URL:** `perry:3847` — this routes to the perry container over
     the docker network. (The cloudflared container joins the same
     network so docker DNS resolves the name.)
3. Click **Save tunnel**.

The full public hostname (e.g. `https://perry.your-domain.com`) will
become your dashboard URL once you bring the tunnel up.

## Start the tunnel container

From the install directory:

```bash
docker compose up -d cloudflared
docker compose logs -f cloudflared
```

You should see lines like:

```
Connection registered  connIndex=0  ip=...  location=...
```

That's the tunnel handshaking with Cloudflare's edge. Open the public
hostname in a browser — you should hit the Perry login screen.

## Updating the route later

If you change the docker network name or the perry container's internal
port (you shouldn't), you can update the route in the Cloudflare
dashboard under **Networks → Tunnels → your tunnel → Public Hostname**.
No code changes or container rebuilds needed.

## Adding more public hostnames

Want to expose `n8n`, ComfyUI, or another internal service publicly?

1. **Networks → Tunnels → your tunnel → Public Hostname → Add a public
   hostname**.
2. Add another route — e.g. `comfy.your-domain.com` → `comfyui:8188`.
3. Save. No restart required — cloudflared picks the new route up
   automatically because routing config lives in Cloudflare's dashboard,
   not in your compose file.

## Locking the dashboard down

The public hostname is just a network route — anyone who finds the URL
can hit the dashboard. Two layers of protection are recommended:

1. **The dashboard's own auth.** `PERRY_API_KEY` in `.env` gates
   `/api/*`. Don't share that key. The installer generates a 32-byte
   random hex key for you.
2. **Cloudflare Access (free for 50 users).** Adds a Zero Trust SSO
   layer in front of the tunnel — only authenticated team members /
   emails reach the dashboard at all. Configure under
   **Cloudflare One → Access → Applications**.

## Troubleshooting

**Tunnel doesn't connect:** `docker compose logs cloudflared`. The most
common cause is a malformed token (extra whitespace / quotes when you
pasted it into `.env`). Double-check the value.

**Public URL returns 502:** the route points at a service that isn't
healthy. Run `docker compose ps` — make sure `perry` is `Up (healthy)`.
If perry is still booting, wait 30-60s and retry.

**DNS not resolving:** Cloudflare provisions the DNS record
automatically when you save the public hostname. Propagation usually
takes seconds but can take minutes; check
**DNS → Records** to confirm an `A`/`CNAME` for your subdomain exists.

**I removed the token from `.env` and the tunnel keeps running:**
container env is captured at start. Restart it: `docker compose restart
cloudflared`.

## Removing public access entirely

To go back to local-only:

1. Edit `.env`, remove `public` from `COMPOSE_PROFILES`, blank
   `CLOUDFLARE_TUNNEL_TOKEN`.
2. `docker compose stop cloudflared && docker compose rm -f cloudflared`.
3. Optionally, delete the tunnel in the Cloudflare dashboard so the
   public hostname stops resolving.
