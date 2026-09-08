FROM node:20-slim

WORKDIR /app

# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY backend/package.json backend/package-lock.json ./
COPY package.json package-lock.json ../

# Install dependencies
RUN npm install --production=false

# Copy source
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Create backups directory
RUN mkdir -p backups

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start
CMD ["node", "--import", "tsx", "src/index.ts"]