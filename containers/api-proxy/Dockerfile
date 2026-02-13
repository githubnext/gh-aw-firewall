# Node.js API proxy for credential management
# Routes through Squid to respect domain whitelisting
FROM node:22-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies from lockfile
RUN npm install --omit=dev

# Copy application files
COPY server.js ./

# Create non-root user
RUN addgroup -S apiproxy && adduser -S apiproxy -G apiproxy

# Switch to non-root user
USER apiproxy

# Expose ports
# 10000 - OpenAI API proxy
# 10001 - Anthropic API proxy
EXPOSE 10000 10001

# Start the proxy server
CMD ["node", "server.js"]
