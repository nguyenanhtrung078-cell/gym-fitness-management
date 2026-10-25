FROM node:22-alpine

WORKDIR /app

# 1. Install production dependencies and create non-root user (container hardening)
COPY package*.json ./
RUN npm install --omit=dev && addgroup -S appgroup && adduser -S appuser -G appgroup

# 2. Copy application files with unprivileged user ownership
COPY --chown=appuser:appgroup . .

# 3. Switch to non-root user
USER appuser

EXPOSE 3000
CMD ["npm", "start"]
