import { SquidConfig } from './types';
import {
  parseDomainList,
  isDomainMatchedByPattern,
  PlainDomainEntry,
  DomainPattern,
} from './domain-patterns';

/**
 * Groups domains/patterns by their protocol restriction
 */
interface DomainsByProtocol {
  http: string[];
  https: string[];
  both: string[];
}

/**
 * Groups patterns by their protocol restriction
 */
interface PatternsByProtocol {
  http: DomainPattern[];
  https: DomainPattern[];
  both: DomainPattern[];
}

/**
 * Helper to add leading dot to domain for Squid subdomain matching
 */
function formatDomainForSquid(domain: string): string {
  return domain.startsWith('.') ? domain : `.${domain}`;
}

/**
 * Group plain domains by protocol
 */
function groupDomainsByProtocol(domains: PlainDomainEntry[]): DomainsByProtocol {
  const result: DomainsByProtocol = { http: [], https: [], both: [] };
  for (const entry of domains) {
    result[entry.protocol].push(entry.domain);
  }
  return result;
}

/**
 * Group patterns by protocol
 */
function groupPatternsByProtocol(patterns: DomainPattern[]): PatternsByProtocol {
  const result: PatternsByProtocol = { http: [], https: [], both: [] };
  for (const pattern of patterns) {
    result[pattern.protocol].push(pattern);
  }
  return result;
}

/**
 * Generates Squid proxy configuration with domain whitelisting
 *
 * Supports both plain domains and wildcard patterns:
 * - Plain domains use dstdomain ACL (efficient, fast matching)
 * - Wildcard patterns use dstdom_regex ACL (regex matching)
 *
 * Supports protocol-specific domain restrictions:
 * - http://domain.com  -> allow only HTTP traffic
 * - https://domain.com -> allow only HTTPS traffic
 * - domain.com         -> allow both HTTP and HTTPS (default)
 *
 * @example
 * // Plain domain: github.com -> acl allowed_domains dstdomain .github.com
 * // Wildcard: *.github.com -> acl allowed_domains_regex dstdom_regex -i ^.*\.github\.com$
 * // HTTP only: http://api.example.com -> separate ACL with !CONNECT rule
 */
export function generateSquidConfig(config: SquidConfig): string {
  const { domains, port } = config;

  // Parse domains into plain domains and wildcard patterns
  // Note: parseDomainList now preserves protocol info instead of stripping it
  // This also validates all inputs and throws on invalid patterns
  const { plainDomains, patterns } = parseDomainList(domains);

  // Remove redundant plain subdomains within same protocol
  // (e.g., if github.com with 'both' is present, api.github.com with 'both' is redundant)
  const uniquePlainDomains = plainDomains.filter((entry, index, arr) => {
    // Check if this domain is a subdomain of another plain domain with compatible protocol
    return !arr.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      // Check if this domain is a subdomain of other
      if (entry.domain === other.domain || !entry.domain.endsWith('.' + other.domain)) {
        return false;
      }
      // Subdomain is only redundant if parent has same or broader protocol
      return other.protocol === 'both' || other.protocol === entry.protocol;
    });
  });

  // Remove plain domains that are already covered by wildcard patterns
  const filteredPlainDomains = uniquePlainDomains.filter(entry => {
    return !isDomainMatchedByPattern(entry, patterns);
  });

  // Group domains and patterns by protocol
  const domainsByProto = groupDomainsByProtocol(filteredPlainDomains);
  const patternsByProto = groupPatternsByProtocol(patterns);

  // Generate ACL entries
  const aclLines: string[] = [];
  const accessRules: string[] = [];

  // === DOMAINS FOR BOTH PROTOCOLS (current behavior) ===
  if (domainsByProto.both.length > 0) {
    aclLines.push('# ACL definitions for allowed domains (HTTP and HTTPS)');
    for (const domain of domainsByProto.both) {
      aclLines.push(`acl allowed_domains dstdomain ${formatDomainForSquid(domain)}`);
    }
  }

  // === PATTERNS FOR BOTH PROTOCOLS ===
  if (patternsByProto.both.length > 0) {
    aclLines.push('');
    aclLines.push('# ACL definitions for allowed domain patterns (HTTP and HTTPS)');
    for (const p of patternsByProto.both) {
      aclLines.push(`acl allowed_domains_regex dstdom_regex -i ${p.regex}`);
    }
  }

  // === HTTP-ONLY DOMAINS ===
  if (domainsByProto.http.length > 0) {
    aclLines.push('');
    aclLines.push('# ACL definitions for HTTP-only domains');
    for (const domain of domainsByProto.http) {
      aclLines.push(`acl allowed_http_only dstdomain ${formatDomainForSquid(domain)}`);
    }
  }

  // === HTTP-ONLY PATTERNS ===
  if (patternsByProto.http.length > 0) {
    aclLines.push('');
    aclLines.push('# ACL definitions for HTTP-only domain patterns');
    for (const p of patternsByProto.http) {
      aclLines.push(`acl allowed_http_only_regex dstdom_regex -i ${p.regex}`);
    }
  }

  // === HTTPS-ONLY DOMAINS ===
  if (domainsByProto.https.length > 0) {
    aclLines.push('');
    aclLines.push('# ACL definitions for HTTPS-only domains');
    for (const domain of domainsByProto.https) {
      aclLines.push(`acl allowed_https_only dstdomain ${formatDomainForSquid(domain)}`);
    }
  }

  // === HTTPS-ONLY PATTERNS ===
  if (patternsByProto.https.length > 0) {
    aclLines.push('');
    aclLines.push('# ACL definitions for HTTPS-only domain patterns');
    for (const p of patternsByProto.https) {
      aclLines.push(`acl allowed_https_only_regex dstdom_regex -i ${p.regex}`);
    }
  }

  // Build access rules
  // Order matters: allow rules come before deny rules

  // Allow HTTP-only domains for non-CONNECT requests
  const hasHttpOnly = domainsByProto.http.length > 0 || patternsByProto.http.length > 0;
  if (hasHttpOnly) {
    if (domainsByProto.http.length > 0 && patternsByProto.http.length > 0) {
      accessRules.push('http_access allow !CONNECT allowed_http_only');
      accessRules.push('http_access allow !CONNECT allowed_http_only_regex');
    } else if (domainsByProto.http.length > 0) {
      accessRules.push('http_access allow !CONNECT allowed_http_only');
    } else {
      accessRules.push('http_access allow !CONNECT allowed_http_only_regex');
    }
  }

  // Allow HTTPS-only domains for CONNECT requests
  const hasHttpsOnly = domainsByProto.https.length > 0 || patternsByProto.https.length > 0;
  if (hasHttpsOnly) {
    if (domainsByProto.https.length > 0 && patternsByProto.https.length > 0) {
      accessRules.push('http_access allow CONNECT allowed_https_only');
      accessRules.push('http_access allow CONNECT allowed_https_only_regex');
    } else if (domainsByProto.https.length > 0) {
      accessRules.push('http_access allow CONNECT allowed_https_only');
    } else {
      accessRules.push('http_access allow CONNECT allowed_https_only_regex');
    }
  }

  // Build the deny rule for domains that allow both protocols
  const hasBothDomains = domainsByProto.both.length > 0;
  const hasBothPatterns = patternsByProto.both.length > 0;

  let denyRule: string;
  if (hasBothDomains && hasBothPatterns) {
    denyRule = 'http_access deny !allowed_domains !allowed_domains_regex';
  } else if (hasBothDomains) {
    denyRule = 'http_access deny !allowed_domains';
  } else if (hasBothPatterns) {
    denyRule = 'http_access deny !allowed_domains_regex';
  } else if (hasHttpOnly || hasHttpsOnly) {
    // Only protocol-specific domains - deny all by default
    // The allow rules above will permit the specific traffic
    denyRule = 'http_access deny all';
  } else {
    // No domains configured
    denyRule = 'http_access deny all';
  }

  // Combine ACL section
  const aclSection = aclLines.length > 0 ? aclLines.join('\n') : '# No domains configured';

  // Combine access rules section for protocol-specific domains
  const accessRulesSection = accessRules.length > 0
    ? '# Protocol-specific domain access rules\n' + accessRules.join('\n') + '\n\n'
    : '';

  return `# Squid configuration for egress traffic control
# Generated by awf

# Custom log format with detailed connection information
# Format: timestamp client_ip:port dest_domain dest_ip:port protocol method status decision url user_agent
# Note: For CONNECT requests (HTTPS), the domain is in the URL field
logformat firewall_detailed %ts.%03tu %>a:%>p %{Host}>h %<a:%<p %rv %rm %>Hs %Ss:%Sh %ru "%{User-Agent}>h"

# Access log and cache configuration
access_log /var/log/squid/access.log firewall_detailed
cache_log /var/log/squid/cache.log
cache deny all

# Port configuration
http_port ${port}

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

${accessRulesSection}# Deny requests to unknown domains (not in allow-list)
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
