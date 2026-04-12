FROM node:20-bookworm-slim

WORKDIR /app

# Build tools are required to compile native modules like sqlite3 for target CPU/GLIBC.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

# Install production dependencies first for better layer caching.
COPY package.json ./
RUN npm_config_build_from_source=true npm install --omit=dev --no-audit --no-fund

# Copy application code.
COPY src ./src
COPY scripts ./scripts
COPY questions.json ./questions.json
COPY llm-prompt.md ./llm-prompt.md
COPY images ./images

# Ensure writable runtime data directory for SQLite.
RUN mkdir -p /app/data

ENV NODE_ENV=production

# Run idempotent migration on startup, then launch bot.
CMD ["sh", "-c", "npm run migrate && npm start"]
