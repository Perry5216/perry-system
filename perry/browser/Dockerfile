# Perry headless-browser fetcher
#
# Uses the official Playwright image (Chromium + system deps preinstalled)
# to keep our Dockerfile tiny. The application is ~80 lines of Express +
# playwright-extra with the stealth plugin, mounted at /app.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install deps before copying app source so they cache across iterations.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# wget is included in the playwright base image; healthcheck uses it.
EXPOSE 3848

CMD ["node", "server.js"]
