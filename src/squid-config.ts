import { SquidConfig } from './types';
import {
  parseDomainList,
  isDomainMatchedByPattern,
} from './domain-patterns';

/**
 * Generates Squid proxy configuration with domain whitelisting
 *
 * Supports both plain domains and wildcard patterns:
 * - Plain domains use dstdomain ACL (efficient, fast matching)
 * - Wildcard patterns use dstdom_regex ACL (regex matching)
 *
 * When SSL bumping is enabled, the configuration includes:
 * - SSL certificate and key paths
 * - ssl_bump directives for HTTPS interception
 * - Enhanced logging to capture decrypted HTTPS payloads
 *
 * @example
 * // Plain domain: github.com -> acl allowed_domains dstdomain .github.com
 * // Wildcard: *.github.com -> acl allowed_domains_regex dstdom_regex -i ^.*\.github\.com$
 * // SSL bumping: ssl_bump peek step1 all; ssl_bump bump all
 */
export function generateSquidConfig(config: SquidConfig): string {
  const { domains, port, sslBump = false } = config;

  // Normalize domains - remove protocol if present
  const normalizedDomains = domains.map(domain => {
    return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  });

  // Parse domains into plain domains and wildcard patterns
  // This also validates all inputs and throws on invalid patterns
  const { plainDomains, patterns } = parseDomainList(normalizedDomains);

  // Remove redundant plain subdomains (e.g., if github.com is present, api.github.com is redundant)
  const uniquePlainDomains = plainDomains.filter((domain, index, arr) => {
    // Check if this domain is a subdomain of another plain domain in the list
    return !arr.some((otherDomain, otherIndex) => {
      if (index === otherIndex) return false;
      // Check if domain is a subdomain of otherDomain (but not an exact duplicate)
      return domain !== otherDomain && domain.endsWith('.' + otherDomain);
    });
  });

  // Remove plain domains that are already covered by wildcard patterns
  const filteredPlainDomains = uniquePlainDomains.filter(domain => {
    return !isDomainMatchedByPattern(domain, patterns);
  });

  // Generate ACL entries for plain domains using dstdomain (fast matching)
  const domainAcls = filteredPlainDomains
    .map(domain => {
      // Add leading dot for subdomain matching unless already present
      const domainPattern = domain.startsWith('.') ? domain : `.${domain}`;
      return `acl allowed_domains dstdomain ${domainPattern}`;
    })
    .join('\n');

  // Generate ACL entries for wildcard patterns using dstdom_regex
  // Use -i flag for case-insensitive matching (DNS is case-insensitive)
  const patternAcls = patterns
    .map(p => `acl allowed_domains_regex dstdom_regex -i ${p.regex}`)
    .join('\n');

  // Determine the ACL section and deny rule based on what we have
  let aclSection = '';
  let denyRule: string;

  if (filteredPlainDomains.length > 0 && patterns.length > 0) {
    // Both plain domains and patterns
    aclSection = `# ACL definitions for allowed domains\n${domainAcls}\n\n# ACL definitions for allowed domain patterns (wildcard)\n${patternAcls}`;
    denyRule = 'http_access deny !allowed_domains !allowed_domains_regex';
  } else if (filteredPlainDomains.length > 0) {
    // Only plain domains
    aclSection = `# ACL definitions for allowed domains\n${domainAcls}`;
    denyRule = 'http_access deny !allowed_domains';
  } else if (patterns.length > 0) {
    // Only patterns
    aclSection = `# ACL definitions for allowed domain patterns (wildcard)\n${patternAcls}`;
    denyRule = 'http_access deny !allowed_domains_regex';
  } else {
    // No domains - deny all (edge case, should not happen with validation)
    aclSection = '# No domains configured';
    denyRule = 'http_access deny all';
  }

  // Port configuration - different for SSL bumping vs normal mode
  let portConfig: string;
  let sslBumpConfig = '';
  
  if (sslBump) {
    // SSL bumping enabled - configure HTTPS interception port
    portConfig = `# HTTPS interception port (SSL bumping enabled)
# This port terminates TLS connections to inspect encrypted payloads
https_port ${port} intercept ssl-bump \\
  cert=/etc/squid/ssl_cert/squid.pem \\
  key=/etc/squid/ssl_cert/squid.pem \\
  generate-host-certificates=on \\
  dynamic_cert_mem_cache_size=4MB`;

    // Determine which ACLs to reference in ssl_bump rule
    let sslBumpAcls: string;
    if (filteredPlainDomains.length > 0 && patterns.length > 0) {
      sslBumpAcls = 'allowed_domains allowed_domains_regex';
    } else if (filteredPlainDomains.length > 0) {
      sslBumpAcls = 'allowed_domains';
    } else if (patterns.length > 0) {
      sslBumpAcls = 'allowed_domains_regex';
    } else {
      // No domains - shouldn't happen with validation, but handle gracefully
      sslBumpAcls = '';
    }

    // SSL bumping rules and ACLs
    sslBumpConfig = `
# SSL bumping configuration for HTTPS payload inspection
# Step 1: Peek at SNI to determine destination
# Step 2: Bump (intercept) allowed connections, splice (tunnel) denied ones

# ACL for SSL bump steps
acl step1 at_step SslBump1
acl step2 at_step SslBump2
acl step3 at_step SslBump3

# Peek at step 1 to see SNI
ssl_bump peek step1

# At step 2, after peeking, bump allowed domains (decrypt and inspect)
ssl_bump bump step2 ${sslBumpAcls}

# Terminate (block) denied connections
ssl_bump terminate step2

# SSL database directory for caching
sslcrtd_program /usr/lib/squid/security_file_certgen -s /var/lib/squid/ssl_db -M 4MB

# Enable password caching for performance
sslcrtd_children 5

# SSL options
ssl_bump_errors allow all
`;
  } else {
    // Normal mode - simple HTTP proxy port
    portConfig = `# HTTP proxy port
http_port ${port}`;
  }

  return `# Squid configuration for egress traffic control
# Generated by awf
${sslBump ? '# SSL BUMPING ENABLED - HTTPS payload will be intercepted and logged\n' : ''}
# Custom log format with detailed connection information
# Format: timestamp client_ip:port dest_domain dest_ip:port protocol method status decision url user_agent
# Note: For CONNECT requests (HTTPS), the domain is in the URL field${sslBump ? '\n# With SSL bumping: Full HTTP URLs inside HTTPS are visible' : ''}
logformat firewall_detailed %ts.%03tu %>a:%>p %{Host}>h %<a:%<p %rv %rm %>Hs %Ss:%Sh %ru "%{User-Agent}>h"

# Access log and cache configuration
access_log /var/log/squid/access.log firewall_detailed
cache_log /var/log/squid/cache.log
cache deny all

${portConfig}
${sslBumpConfig}
${aclSection}

# Network ACLs
acl localnet src 10.0.0.0/8
acl localnet src 172.16.0.0/12
acl localnet src 192.168.0.0/16
acl localnet src fc00::/7
acl localnet src fe80::/10

# Port ACLs
acl SSL_ports port 443
acl Safe_ports port 80
acl Safe_ports port 443
acl CONNECT method CONNECT

# Access rules
# Deny unsafe ports first
http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports

# Deny requests to unknown domains (not in allow-list)
# This applies to all sources including localnet
${denyRule}

# Allow from trusted sources (after domain filtering)
http_access allow localnet
http_access allow localhost

# Deny everything else
http_access deny all

# Disable caching
cache deny all

# DNS settings
dns_nameservers 8.8.8.8 8.8.4.4

# Forwarded headers
forwarded_for delete
via off

# Error page customization
error_directory /usr/share/squid/errors/en

# Memory and file descriptor limits
cache_mem 64 MB
maximum_object_size 0 KB

# Timeout settings for streaming/long-lived connections (AI inference APIs)
# read_timeout: Time to wait for data from server before giving up
# Increased to accommodate long AI inference calls and SSE streaming
read_timeout 30 minutes

# connect_timeout: Time to wait for TCP connection to origin server
connect_timeout 30 seconds

# request_timeout: Time to wait for client to send first request after connection
request_timeout 2 minutes

# persistent_request_timeout: Time to wait for next request on persistent connection
persistent_request_timeout 2 minutes

# pconn_timeout: How long to keep idle persistent connections to servers
pconn_timeout 2 minutes

# client_lifetime: Maximum time a client connection can be open
# Set high to accommodate long streaming sessions
client_lifetime 8 hours

# half_closed_clients: Allow half-closed connections for streaming
# Critical for SSE where server sends but client doesn't respond
half_closed_clients on

# Debugging (can be enabled for troubleshooting)
# debug_options ALL,1 33,2
`;
}
