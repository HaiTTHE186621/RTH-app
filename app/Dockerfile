FROM node:22-slim AS builder
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Build React frontend
RUN npm run build

# Production stage
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source
COPY src ./src
COPY test ./test
COPY entrypoint.sh ./

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

RUN chmod +x entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["sh", "./entrypoint.sh"]
CMD ["start"]
