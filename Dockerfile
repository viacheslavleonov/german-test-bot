FROM node:20-bookworm-slim

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

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
