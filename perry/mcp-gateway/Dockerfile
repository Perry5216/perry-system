# Perry MCP Gateway — Atlassian mcp-compressor as a reverse proxy
#
# Workers connect to:  http://mcp-gateway:3851/mcp
# Gateway forwards to: http://perry:3850/mcp (and future MCP servers)
#
# Architecture:
#   [worker.claude] ──MCP──► [mcp-gateway:3851] ──compresses + proxies──► [perry:3850/mcp]
#
# History — why we don't use the npm package:
#   The @atlassian/mcp-compressor npm tarball ships only the Node CLI wrapper
#   (dist/cli.js) and an unused N-API binding (native/*.node). The actual
#   proxy is a separate Rust binary that the upstream expects you to build
#   from source via `cargo build -p mcp-compressor` (per the package README,
#   though their cli.js error message says `-p mcp-compressor-core` which
#   is the LIBRARY crate, not the binary — bug in their hint).
#
#   The wrapper we previously installed at /usr/local/bin/mcp-compressor
#   recursed back into cli.js whenever cli.js's spawn() couldn't find a real
#   Rust binary. Result: parent→child→grandchild fork chain, 18k+ PIDs,
#   34 GB RAM, daemon-killing runaway (observed 2026-05-21).
#
#   Real fix: build the actual Rust binary in a builder stage, ship it to
#   the runtime stage. No node, no cli.js, no recursive wrapper.

# ─── Stage 1: build the Rust binary ────────────────────────────────────
FROM rust:1-slim-bookworm AS builder

ARG MCP_COMPRESSOR_VERSION=v0.22.1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${MCP_COMPRESSOR_VERSION} \
        https://github.com/atlassian-labs/mcp-compressor.git .

# Upstream hard-codes the streamable-http listener to 127.0.0.1 with no
# CLI override (crates/mcp-compressor-core/src/app/runtime.rs). Loopback
# is fine for desktop installs but unusable inside a container where
# other containers connect via docker DNS. Two patches:
#   1. bind 0.0.0.0 instead of 127.0.0.1 so the port is reachable
#   2. disable_allowed_hosts() — rmcp's DNS-rebinding defence rejects
#      any Host header that isn't a loopback alias; "mcp-gateway:3851"
#      from a sibling container would otherwise get HTTP 403. We are
#      docker-internal only (no host port mapping), so it's safe.
# Track upstream issue / PR: github.com/atlassian-labs/mcp-compressor
RUN sed -i \
        -e 's/Ipv4Addr::LOCALHOST, cli.port/Ipv4Addr::UNSPECIFIED, cli.port/' \
        -e 's/StreamableHttpServerConfig::default().with_sse_keep_alive(None)/StreamableHttpServerConfig::default().with_sse_keep_alive(None).disable_allowed_hosts()/' \
        crates/mcp-compressor-core/src/app/runtime.rs \
    && grep -q 'Ipv4Addr::UNSPECIFIED, cli.port' \
        crates/mcp-compressor-core/src/app/runtime.rs \
    && grep -q 'disable_allowed_hosts' \
        crates/mcp-compressor-core/src/app/runtime.rs

# Build the BINARY crate (not the -core library crate the cli.js error
# message mentions — that one produces no executable).
RUN cargo build --release -p mcp-compressor \
    && /src/target/release/mcp-compressor --version

# ─── Stage 2: runtime image ────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        bash ca-certificates libssl3 wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/mcp-compressor /usr/local/bin/mcp-compressor
COPY start-gateway.sh /usr/local/bin/start-gateway.sh
RUN chmod +x /usr/local/bin/start-gateway.sh

# Sanity: confirm the binary runs in the runtime image (catches glibc
# version mismatch between builder and runtime — both are bookworm so
# this should always succeed; failing here is loud and immediate).
RUN /usr/local/bin/mcp-compressor --version

EXPOSE 3851

ENV COMPRESSION_LEVEL=medium
ENV UPSTREAM_URL=http://perry:3850/mcp
ENV PERRY_WORKER_SECRET=""

# Startup script writes the MCP config JSON (env-interpolated) then
# exec's the Rust binary. The Rust binary has no -H flag, so headers
# must go through the --config JSON file.
ENTRYPOINT ["/usr/local/bin/start-gateway.sh"]
