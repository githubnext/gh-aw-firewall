# Nginx-based API proxy for OpenAI and Anthropic APIs
# Injects authentication tokens and routes through Squid proxy
FROM nginx:1.27-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy nginx configuration template and entrypoint script
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create temporary directories for nginx (non-root compatible)
RUN mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp && \
    chmod 777 /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp

# Create non-root user
RUN addgroup -S apiproxy && adduser -S apiproxy -G apiproxy && \
    chown -R apiproxy:apiproxy /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /etc/nginx && \
    chown apiproxy:apiproxy /entrypoint.sh

# Switch to non-root user
USER apiproxy

# Expose ports
# 10000 - OpenAI API proxy
# 10001 - Anthropic API proxy
EXPOSE 10000 10001

# Use entrypoint script to substitute environment variables
ENTRYPOINT ["/entrypoint.sh"]
