FROM node:20-slim AS base

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Install dev dependencies for build step
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm ci --only=production && npm cache clean --force

# Create recordings directory
RUN mkdir -p recordings && chmod 755 recordings

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["node", "dist/index.js"]

# Expose default ports (though RTP ports are configurable)
EXPOSE 5060/udp 10000-20000/udp