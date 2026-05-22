FROM node:22-alpine

WORKDIR /app

# Enable corepack for npm/yarn/pnpm management if needed, but we use standard npm workspaces
RUN corepack enable

# Copy package manifests first to cache dependencies
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/ai/package.json ./packages/ai/
COPY packages/rag/package.json ./packages/rag/
COPY packages/projects/package.json ./packages/projects/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/dashboard-api/package.json ./packages/dashboard-api/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Install native build tools required for better-sqlite3 and canvas (node-canvas)
# canvas needs cairo, pango, libjpeg, libpng, giflib, pixman for 2D compositing
RUN apk add --no-cache python3 make g++ cairo-dev pango-dev libjpeg-turbo-dev giflib-dev docker-cli git

# Install dependencies (allowing scripts to run so better-sqlite3 compiles)
RUN npm install

# Copy the rest of the source code
COPY . .

# Build all packages
RUN npm run build

# Set production environment
ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

# Start two processes:
#   1. MCP HTTP server (background) — perry-worker container's Claude
#      connects here to use the Perry MCP tools (claim_task, report_task,
#      get_project_context, etc). Listens on PERRY_MCP_HTTP_PORT.
#   2. Dashboard API server (foreground) — the dashboard UI + project pipeline.
#
# Host-side Claude still spawns the MCP server itself via `docker exec`
# (stdio transport, separate ephemeral process) — this background one is
# only for the perry-worker container's HTTP transport.
CMD ["sh", "-c", "PERRY_MCP_HTTP_PORT=3850 node /app/packages/mcp-server/dist/index.js & exec node /app/packages/dashboard-api/dist/index.js"]
