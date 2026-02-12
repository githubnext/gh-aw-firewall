#!/bin/bash
set -e

# Generate Envoy configuration from environment variables
# This allows API keys to be injected at runtime without persisting to disk

# Start building the configuration
cat > /etc/envoy/envoy.yaml <<EOF
static_resources:
  listeners:
  # OpenAI API proxy (Codex)
  - name: openai_listener
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 10000
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: openai_ingress
          codec_type: AUTO
          route_config:
            name: openai_route
            virtual_hosts:
            - name: openai_service
              domains: ["*"]
              routes:
              - match:
                  prefix: "/"
                route:
                  cluster: openai_cluster
                  timeout: 300s
EOF

# Add Authorization header injection for OpenAI if API key is provided
if [ -n "$OPENAI_API_KEY" ]; then
  cat >> /etc/envoy/envoy.yaml <<EOF
                request_headers_to_add:
                - header:
                    key: "Authorization"
                    value: "Bearer ${OPENAI_API_KEY}"
                  append_action: OVERWRITE_IF_EXISTS_OR_ADD
EOF
fi

cat >> /etc/envoy/envoy.yaml <<EOF
          http_filters:
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  # Anthropic API proxy (Claude)
  - name: anthropic_listener
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 10001
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: anthropic_ingress
          codec_type: AUTO
          route_config:
            name: anthropic_route
            virtual_hosts:
            - name: anthropic_service
              domains: ["*"]
              routes:
              - match:
                  prefix: "/"
                route:
                  cluster: anthropic_cluster
                  timeout: 300s
EOF

# Add API key injection for Anthropic if provided
if [ -n "$ANTHROPIC_API_KEY" ]; then
  cat >> /etc/envoy/envoy.yaml <<EOF
                request_headers_to_add:
                - header:
                    key: "x-api-key"
                    value: "${ANTHROPIC_API_KEY}"
                  append_action: OVERWRITE_IF_EXISTS_OR_ADD
                - header:
                    key: "anthropic-version"
                    value: "2023-06-01"
                  append_action: OVERWRITE_IF_EXISTS_OR_ADD
EOF
fi

cat >> /etc/envoy/envoy.yaml <<EOF
          http_filters:
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router

  clusters:
  # OpenAI API cluster
  - name: openai_cluster
    type: LOGICAL_DNS
    dns_lookup_family: V4_ONLY
    load_assignment:
      cluster_name: openai_cluster
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: api.openai.com
                port_value: 443
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
        sni: api.openai.com
    typed_extension_protocol_options:
      envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
        "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
        explicit_http_config:
          http2_protocol_options: {}

  # Anthropic API cluster
  - name: anthropic_cluster
    type: LOGICAL_DNS
    dns_lookup_family: V4_ONLY
    load_assignment:
      cluster_name: anthropic_cluster
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: api.anthropic.com
                port_value: 443
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
        sni: api.anthropic.com
    typed_extension_protocol_options:
      envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
        "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
        explicit_http_config:
          http2_protocol_options: {}

admin:
  address:
    socket_address:
      address: 127.0.0.1
      port_value: 9901
EOF

echo "[INFO] Generated Envoy configuration"
if [ -n "$OPENAI_API_KEY" ]; then
  echo "[INFO] OpenAI API key configured (first 8 chars: ${OPENAI_API_KEY:0:8}...)"
fi
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "[INFO] Anthropic API key configured (first 8 chars: ${ANTHROPIC_API_KEY:0:8}...)"
fi

# Start Envoy with the generated configuration
exec /usr/local/bin/envoy "$@"
