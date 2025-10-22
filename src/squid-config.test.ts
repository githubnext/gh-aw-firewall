import { generateSquidConfig } from './squid-config';
import { SquidConfig } from './types';

describe('generateSquidConfig', () => {
  const defaultPort = 3128;

  describe('Domain Normalization', () => {
    it('should remove http:// protocol prefix', () => {
      const config: SquidConfig = {
        domains: ['http://github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toContain('http://');
    });

    it('should remove https:// protocol prefix', () => {
      const config: SquidConfig = {
        domains: ['https://api.github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .api.github.com');
      expect(result).not.toContain('https://');
    });

    it('should remove trailing slash', () => {
      const config: SquidConfig = {
        domains: ['github.com/'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toMatch(/github\.com\//);
    });

    it('should remove both protocol and trailing slash', () => {
      const config: SquidConfig = {
        domains: ['https://example.com/'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .example.com');
      expect(result).not.toContain('https://');
      expect(result).not.toMatch(/example\.com\//);
    });

    it('should handle domain with port number', () => {
      const config: SquidConfig = {
        domains: ['example.com:8080'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Port should be preserved in the domain
      expect(result).toContain('acl allowed_domains dstdomain .example.com:8080');
    });

    it('should handle domain with path', () => {
      const config: SquidConfig = {
        domains: ['https://api.github.com/v3/users'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Path should be preserved (Squid handles domain matching)
      expect(result).toContain('acl allowed_domains dstdomain .api.github.com/v3/users');
    });
  });

  describe('Subdomain Handling', () => {
    it('should add leading dot for subdomain matching', () => {
      const config: SquidConfig = {
        domains: ['github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
    });

    it('should preserve existing leading dot', () => {
      const config: SquidConfig = {
        domains: ['.github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should only have one leading dot, not two
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toContain('..github.com');
    });

    it('should allow multiple independent domains', () => {
      const config: SquidConfig = {
        domains: ['github.com', 'gitlab.com', 'bitbucket.org'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).toContain('acl allowed_domains dstdomain .gitlab.com');
      expect(result).toContain('acl allowed_domains dstdomain .bitbucket.org');
    });
  });

  describe('Redundant Subdomain Removal', () => {
    it('should remove subdomain when parent domain is present', () => {
      const config: SquidConfig = {
        domains: ['github.com', 'api.github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should only contain github.com, not api.github.com
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toContain('acl allowed_domains dstdomain .api.github.com');
      // Should only have one ACL line for github.com
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(1);
    });

    it('should remove multiple subdomains when parent domain is present', () => {
      const config: SquidConfig = {
        domains: ['github.com', 'api.github.com', 'raw.github.com', 'gist.github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should only contain github.com
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toContain('api.github.com');
      expect(result).not.toContain('raw.github.com');
      expect(result).not.toContain('gist.github.com');
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(1);
    });

    it('should keep nested subdomains when intermediate parent is not present', () => {
      const config: SquidConfig = {
        domains: ['api.v2.example.com', 'example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should only contain example.com since it's the parent
      expect(result).toContain('acl allowed_domains dstdomain .example.com');
      expect(result).not.toContain('api.v2.example.com');
    });

    it('should preserve subdomains when parent is not in the list', () => {
      const config: SquidConfig = {
        domains: ['api.github.com', 'raw.github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should contain both subdomains since github.com is not in the list
      expect(result).toContain('acl allowed_domains dstdomain .api.github.com');
      expect(result).toContain('acl allowed_domains dstdomain .raw.github.com');
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(2);
    });

    it('should handle mixed parent and subdomain correctly', () => {
      const config: SquidConfig = {
        domains: ['api.github.com', 'github.com', 'gitlab.com', 'api.gitlab.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should only contain github.com and gitlab.com (parents)
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).toContain('acl allowed_domains dstdomain .gitlab.com');
      expect(result).not.toContain('api.github.com');
      expect(result).not.toContain('api.gitlab.com');
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(2);
    });

    it('should not remove domains that look similar but are not subdomains', () => {
      const config: SquidConfig = {
        domains: ['github.com', 'mygithub.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Both should be preserved as they are independent domains
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).toContain('acl allowed_domains dstdomain .mygithub.com');
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty domain list', () => {
      const config: SquidConfig = {
        domains: [],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Should not contain any ACL lines for allowed_domains
      expect(result).not.toContain('acl allowed_domains dstdomain');
    });

    it('should handle single domain', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .example.com');
      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(1);
    });

    it('should handle domains with hyphens', () => {
      const config: SquidConfig = {
        domains: ['my-awesome-site.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .my-awesome-site.com');
    });

    it('should handle domains with numbers', () => {
      const config: SquidConfig = {
        domains: ['api123.example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .api123.example.com');
    });

    it('should handle international domains', () => {
      const config: SquidConfig = {
        domains: ['münchen.de', '日本.jp'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .münchen.de');
      expect(result).toContain('acl allowed_domains dstdomain .日本.jp');
    });

    it('should handle duplicate domains', () => {
      const config: SquidConfig = {
        domains: ['github.com', 'github.com', 'github.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Duplicates should result in same number of ACL lines (not filtered at this level)
      const aclLines = result.match(/acl allowed_domains dstdomain .github.com/g);
      expect(aclLines).toHaveLength(3);
    });

    it('should handle mixed case domains', () => {
      const config: SquidConfig = {
        domains: ['GitHub.COM', 'Api.GitHub.COM'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // Case should be preserved (DNS is case-insensitive but this is up to Squid)
      expect(result).toContain('.GitHub.COM');
    });

    it('should handle very long subdomain chains', () => {
      const config: SquidConfig = {
        domains: ['a.b.c.d.e.f.example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .a.b.c.d.e.f.example.com');
    });

    it('should handle TLD-only domain (edge case)', () => {
      const config: SquidConfig = {
        domains: ['com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('acl allowed_domains dstdomain .com');
    });
  });

  describe('Configuration Structure', () => {
    it('should use the specified port', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: 8080,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('http_port 8080');
      expect(result).not.toContain('http_port 3128');
    });

    it('should include all required Squid configuration sections', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);

      // Check for key configuration sections
      expect(result).toContain('access_log');
      expect(result).toContain('cache_log');
      expect(result).toContain('cache deny all');
      expect(result).toContain('http_port');
      expect(result).toContain('acl localnet');
      expect(result).toContain('acl SSL_ports');
      expect(result).toContain('acl Safe_ports');
      expect(result).toContain('acl CONNECT method CONNECT');
      expect(result).toContain('http_access deny !allowed_domains');
      expect(result).toContain('dns_nameservers');
      // Check for custom log format
      expect(result).toContain('logformat firewall_detailed');
    });

    it('should deny access to domains not in the allowlist', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('http_access deny !allowed_domains');
    });

    it('should disable caching', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('cache deny all');
    });
  });

  describe('Domain Ordering', () => {
    it('should preserve order of independent domains', () => {
      const config: SquidConfig = {
        domains: ['alpha.com', 'beta.com', 'gamma.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      const alphaIndex = result.indexOf('.alpha.com');
      const betaIndex = result.indexOf('.beta.com');
      const gammaIndex = result.indexOf('.gamma.com');

      expect(alphaIndex).toBeLessThan(betaIndex);
      expect(betaIndex).toBeLessThan(gammaIndex);
    });
  });

  describe('Logging Configuration', () => {
    it('should include custom firewall_detailed log format', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('logformat firewall_detailed');
    });

    it('should log timestamp with milliseconds', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %ts.%03tu provides timestamp in seconds.milliseconds format
      expect(result).toMatch(/logformat firewall_detailed.*%ts\.%03tu/);
    });

    it('should log client IP and port', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %>a:%>p provides client IP:port
      expect(result).toMatch(/logformat firewall_detailed.*%>a:%>p/);
    });

    it('should log destination domain and IP:port', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %{Host}>h for domain, %<a:%<p for dest IP:port
      expect(result).toMatch(/logformat firewall_detailed.*%{Host}>h.*%<a:%<p/);
    });

    it('should log protocol and HTTP method', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %rv for protocol version, %rm for request method
      expect(result).toMatch(/logformat firewall_detailed.*%rv.*%rm/);
    });

    it('should log HTTP status code', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %>Hs for HTTP status code
      expect(result).toMatch(/logformat firewall_detailed.*%>Hs/);
    });

    it('should log decision (Squid status:hierarchy)', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // %Ss:%Sh provides decision like TCP_DENIED:HIER_NONE or TCP_TUNNEL:HIER_DIRECT
      expect(result).toMatch(/logformat firewall_detailed.*%Ss:%Sh/);
    });

    it('should include comment about CONNECT requests for HTTPS', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      // For HTTPS/CONNECT requests, domain is in the URL field
      expect(result).toContain('For CONNECT requests (HTTPS), the domain is in the URL field');
    });

    it('should use firewall_detailed format for access_log', () => {
      const config: SquidConfig = {
        domains: ['example.com'],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);
      expect(result).toContain('access_log /var/log/squid/access.log firewall_detailed');
    });
  });

  describe('Real-world Domain Patterns', () => {
    it('should handle GitHub-related domains', () => {
      const config: SquidConfig = {
        domains: [
          'github.com',
          'api.github.com',
          'raw.githubusercontent.com',
          'github.githubassets.com',
        ],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);

      // github.com should be present, api.github.com should be removed
      expect(result).toContain('acl allowed_domains dstdomain .github.com');
      expect(result).not.toContain('api.github.com');

      // Other independent domains should remain
      expect(result).toContain('acl allowed_domains dstdomain .raw.githubusercontent.com');
      expect(result).toContain('acl allowed_domains dstdomain .github.githubassets.com');
    });

    it('should handle AWS-related domains', () => {
      const config: SquidConfig = {
        domains: [
          'amazonaws.com',
          's3.amazonaws.com',
          'ec2.amazonaws.com',
          'lambda.us-east-1.amazonaws.com',
        ],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);

      // Only amazonaws.com should be present
      expect(result).toContain('acl allowed_domains dstdomain .amazonaws.com');
      expect(result).not.toContain('s3.amazonaws.com');
      expect(result).not.toContain('ec2.amazonaws.com');
      expect(result).not.toContain('lambda.us-east-1.amazonaws.com');

      const aclLines = result.match(/acl allowed_domains dstdomain/g);
      expect(aclLines).toHaveLength(1);
    });

    it('should handle CDN domains', () => {
      const config: SquidConfig = {
        domains: [
          'cloudflare.com',
          'cdn.cloudflare.com',
          'cdnjs.cloudflare.com',
        ],
        port: defaultPort,
      };
      const result = generateSquidConfig(config);

      // Only cloudflare.com should be present
      expect(result).toContain('acl allowed_domains dstdomain .cloudflare.com');
      expect(result).not.toContain('cdn.cloudflare.com');
      expect(result).not.toContain('cdnjs.cloudflare.com');
    });
  });
});
