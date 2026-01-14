import { parseUrlPatterns } from './ssl-bump';

describe('SSL Bump', () => {
  describe('parseUrlPatterns', () => {
    it('should escape regex special characters except wildcards', () => {
      const patterns = parseUrlPatterns(['https://github.com/user']);
      expect(patterns).toEqual(['^https://github\\.com/user$']);
    });

    it('should convert * wildcard to .* regex', () => {
      const patterns = parseUrlPatterns(['https://github.com/githubnext/*']);
      expect(patterns).toEqual(['^https://github\\.com/githubnext/.*']);
    });

    it('should handle multiple wildcards', () => {
      const patterns = parseUrlPatterns(['https://api-*.example.com/*']);
      expect(patterns).toEqual(['^https://api-.*\\.example\\.com/.*']);
    });

    it('should remove trailing slash for consistency', () => {
      const patterns = parseUrlPatterns(['https://github.com/']);
      expect(patterns).toEqual(['^https://github\\.com$']);
    });

    it('should handle exact match patterns', () => {
      const patterns = parseUrlPatterns(['https://api.example.com/v1/users']);
      expect(patterns).toEqual(['^https://api\\.example\\.com/v1/users$']);
    });

    it('should handle query parameters', () => {
      const patterns = parseUrlPatterns(['https://api.example.com/v1?key=value']);
      expect(patterns).toEqual(['^https://api\\.example\\.com/v1\\?key=value$']);
    });

    it('should escape dots in domain names', () => {
      const patterns = parseUrlPatterns(['https://sub.domain.example.com/path']);
      expect(patterns).toEqual(['^https://sub\\.domain\\.example\\.com/path$']);
    });

    it('should handle multiple patterns', () => {
      const patterns = parseUrlPatterns([
        'https://github.com/githubnext/*',
        'https://api.example.com/v1/*',
      ]);
      expect(patterns).toHaveLength(2);
      expect(patterns[0]).toBe('^https://github\\.com/githubnext/.*');
      expect(patterns[1]).toBe('^https://api\\.example\\.com/v1/.*');
    });

    it('should handle empty array', () => {
      const patterns = parseUrlPatterns([]);
      expect(patterns).toEqual([]);
    });

    it('should anchor patterns correctly for exact matches', () => {
      const patterns = parseUrlPatterns(['https://github.com/exact']);
      // Should have both start and end anchors for exact matches
      expect(patterns[0]).toBe('^https://github\\.com/exact$');
    });

    it('should not add end anchor for wildcard patterns', () => {
      const patterns = parseUrlPatterns(['https://github.com/*']);
      // Should only have start anchor for patterns ending with .*
      expect(patterns[0]).toBe('^https://github\\.com/.*');
      expect(patterns[0]).not.toContain('$');
    });
  });
});
