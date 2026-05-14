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
COPY packages/export/package.json ./packages/export/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/dashboard-api/package.json ./packages/dashboard-api/

# Install native build tools required for better-sqlite3 and canvas (node-canvas)
# canvas needs cairo, pango, libjpeg, libpng, giflib, pixman for 2D compositing
RUN apk add --no-cache python3 make g++ cairo-dev pango-dev libjpeg-turbo-dev giflib-dev

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

# Start the dashboard API server (which will serve the dashboard UI statically)
CMD ["node", "packages/dashboard-api/dist/index.js"]
