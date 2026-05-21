#!/bin/sh
# Boot the mcp-compressor Rust binary against a remote HTTP MCP server.
#
# The Rust binary (v0.22.1) accepts a backend URL positionally after `--`.
# It does NOT support HTTP headers — neither via CLI flags nor via JSON
# config (the Rust --config parser only knows stdio servers; the npm
# package's TypeScript types claim HTTP support, but it's not implemented
# in the binary). If/when upstream adds header support, we can plumb the
# PERRY_WORKER_SECRET through here.
#
# Perry's MCP server does not currently require auth for traffic on the
# internal docker network, so the missing header capability is fine.
set -e

if [ -n "${PERRY_WORKER_SECRET}" ]; then
  echo "[mcp-gateway] WARNING: PERRY_WORKER_SECRET is set, but mcp-compressor" >&2
  echo "[mcp-gateway]          has no HTTP-header support — secret will be ignored." >&2
fi

exec /usr/local/bin/mcp-compressor \
  --transport streamable-http \
  --port 3851 \
  -c "${COMPRESSION_LEVEL}" \
  -- "${UPSTREAM_URL}" --auth=none
