# Perry CLI Worker container
#
# Hosts the three subscription-CLI tools (Anthropic, Google, OpenAI) as
# a first-class docker service. Replaced the earlier host-spawner
# Windows Service.
#
# Subscription-only mode preserved: this container does NOT use API keys.
# It mounts the host's OAuth state (~/.claude, ~/.gemini, ~/.codex) and
# the CLIs authenticate against the user's existing subscriptions
# (Anthropic Pro/Max, Google Advanced, ChatGPT Plus/Pro).
#
# At boot: starts a tiny HTTP listener that the perry container's
# WorkerCoordinator posts spawn requests to. On each request, runs the
# requested CLI with `-p "/perry-worker"` (or pipes the slash-command
# body via stdin for CLIs without native slash-command discovery) and
# streams output to docker logs.

FROM node:22-alpine

# Install all three CLI tools globally + utilities.
RUN apk add --no-cache bash curl ca-certificates wget \
    && npm install -g \
        @anthropic-ai/claude-code \
        @google/gemini-cli \
        @openai/codex

# Non-root user — the Anthropic CLI refuses to run
# `--dangerously-skip-permissions` as root for safety. The base image
# ships a `node` user at uid 1000; we reuse it instead of minting a
# duplicate. Auth dirs get mounted at /home/node/ in compose.yaml.
RUN mkdir -p /app/logs/workers \
    && chown -R node:node /app

USER node
WORKDIR /app

# Small HTTP listener that the perry container POSTs spawn requests to.
# Internal-only — listens on the docker network, no port exposed to the host.
COPY --chown=node:node listener.cjs /app/listener.cjs

# Project-local .mcp.json so the Anthropic CLI (spawned with cwd=/app)
# discovers the Perry MCP HTTP transport at http://perry:3850/mcp.
# Without this the CLI starts with no Perry tools and can't drain the
# worker queue.
COPY --chown=node:node .mcp.json /app/.mcp.json

# Gemini's project-scope settings — same Perry MCP HTTP transport, picked
# up automatically because the listener spawns gemini with cwd=/app. Keeps
# the host's ~/.gemini/settings.json untouched.
RUN mkdir -p /app/.gemini && chown -R node:node /app/.gemini
COPY --chown=node:node gemini-settings.json /app/.gemini/settings.json

EXPOSE 4711

CMD ["node", "/app/listener.cjs"]
