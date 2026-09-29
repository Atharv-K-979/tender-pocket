# Stage 1: Build & Dependencies
FROM node:24-slim AS base

# Install system dependencies required for pdf processing, tesseract OCR, python parsing, and node native compiling
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    tesseract-ocr \
    poppler-utils \
    build-essential \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
RUN pip3 install --no-cache-dir pypdf || pip3 install --no-cache-dir --break-system-packages pypdf

# Set working directory
WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install dependencies including development dependencies (needed for next build)
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

# Copy application files
COPY . .

# Run next build to compile the production application
RUN DATABASE_PATH=:memory: npm run build

# Stage 2: Production Runner
FROM node:24-slim AS runner

# Install runtime system dependencies (python, tesseract, poppler-utils)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    tesseract-ocr \
    poppler-utils \
    chromium \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
RUN pip3 install --no-cache-dir pypdf || pip3 install --no-cache-dir --break-system-packages pypdf

# Set environment to production
ENV NODE_ENV=production
ENV PORT=8085
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy built application and required production packages
COPY --from=base /app/package*.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/scripts ./scripts
COPY --from=base /app/src ./src
COPY --from=base /app/template.pdf ./template.pdf
COPY --from=base /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Accept Windows build contexts as well as LF-normalized Git checkouts.
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# Make volume data directories
RUN mkdir -p /app/data

# Set volume mount point
VOLUME ["/app/data"]

EXPOSE 8085

ENTRYPOINT ["./docker-entrypoint.sh"]
