import {
  isWildcardPattern,
  wildcardToRegex,
  validateDomainOrPattern,
  parseDomainList,
  isDomainMatchedByPattern,
} from './domain-patterns';

describe('isWildcardPattern', () => {
  it('should detect asterisk wildcard', () => {
    expect(isWildcardPattern('*.github.com')).toBe(true);
    expect(isWildcardPattern('api-*.example.com')).toBe(true);
    expect(isWildcardPattern('*-cdn.example.com')).toBe(true);
    expect(isWildcardPattern('api.*.com')).toBe(true);
  });

  it('should return false for plain domains', () => {
    expect(isWildcardPattern('github.com')).toBe(false);
    expect(isWildcardPattern('api.github.com')).toBe(false);
    expect(isWildcardPattern('.github.com')).toBe(false);
    expect(isWildcardPattern('sub.domain.example.com')).toBe(false);
  });
});

describe('wildcardToRegex', () => {
  describe('basic conversions', () => {
    it('should convert leading wildcard pattern', () => {
      expect(wildcardToRegex('*.github.com')).toBe('^.*\\.github\\.com$');
    });

    it('should convert middle wildcard pattern', () => {
      expect(wildcardToRegex('api-*.example.com')).toBe('^api-.*\\.example\\.com$');
    });

    it('should convert trailing wildcard pattern', () => {
      expect(wildcardToRegex('api.*')).toBe('^api\\..*$');
    });

    it('should handle multiple wildcards', () => {
      expect(wildcardToRegex('*-api-*.example.com')).toBe('^.*-api-.*\\.example\\.com$');
    });
  });

  describe('escaping', () => {
    it('should escape dots in domain', () => {
      expect(wildcardToRegex('*.co.uk')).toBe('^.*\\.co\\.uk$');
    });

    it('should escape regex metacharacters', () => {
      // These are unlikely in domains but should be handled safely
      expect(wildcardToRegex('api+*.example.com')).toBe('^api\\+.*\\.example\\.com$');
      expect(wildcardToRegex('api[1].example.com')).toBe('^api\\[1\\]\\.example\\.com$');
    });
  });

  describe('anchoring', () => {
    it('should anchor regex with ^ and $', () => {
      const regex = wildcardToRegex('*.github.com');
      expect(regex.startsWith('^')).toBe(true);
      expect(regex.endsWith('$')).toBe(true);
    });
  });

  describe('regex validity', () => {
    it('should produce valid regex patterns', () => {
      const patterns = [
        '*.github.com',
        'api-*.example.com',
        '*-cdn.example.com',
        'api.*.example.com',
      ];

      for (const pattern of patterns) {
        const regex = wildcardToRegex(pattern);
        expect(() => new RegExp(regex)).not.toThrow();
      }
    });

    it('should correctly match intended domains', () => {
      const regex = new RegExp(wildcardToRegex('*.github.com'), 'i');
      expect(regex.test('api.github.com')).toBe(true);
      expect(regex.test('raw.github.com')).toBe(true);
      expect(regex.test('sub.api.github.com')).toBe(true);
      expect(regex.test('github.com')).toBe(false); // * requires at least one char before .
      expect(regex.test('notgithub.com')).toBe(false);
      expect(regex.test('github.com.evil.com')).toBe(false);
    });

    it('should handle middle wildcards correctly', () => {
      const regex = new RegExp(wildcardToRegex('api-*.example.com'), 'i');
      expect(regex.test('api-v1.example.com')).toBe(true);
      expect(regex.test('api-test.example.com')).toBe(true);
      expect(regex.test('api-.example.com')).toBe(true); // empty wildcard match
      expect(regex.test('api.example.com')).toBe(false); // missing dash
      expect(regex.test('other.example.com')).toBe(false);
    });
  });
});

describe('validateDomainOrPattern', () => {
  describe('valid inputs', () => {
    it('should accept valid plain domains', () => {
      expect(() => validateDomainOrPattern('github.com')).not.toThrow();
      expect(() => validateDomainOrPattern('api.github.com')).not.toThrow();
      expect(() => validateDomainOrPattern('sub.api.github.com')).not.toThrow();
    });

    it('should accept valid wildcard patterns', () => {
      expect(() => validateDomainOrPattern('*.github.com')).not.toThrow();
      expect(() => validateDomainOrPattern('api-*.example.com')).not.toThrow();
      expect(() => validateDomainOrPattern('*-cdn.example.com')).not.toThrow();
    });

    it('should accept domains with hyphens and numbers', () => {
      expect(() => validateDomainOrPattern('api-v2.github.com')).not.toThrow();
      expect(() => validateDomainOrPattern('123.example.com')).not.toThrow();
    });
  });

  describe('empty/invalid inputs', () => {
    it('should reject empty input', () => {
      expect(() => validateDomainOrPattern('')).toThrow('cannot be empty');
      expect(() => validateDomainOrPattern('   ')).toThrow('cannot be empty');
    });

    it('should reject double dots', () => {
      expect(() => validateDomainOrPattern('github..com')).toThrow('double dots');
      expect(() => validateDomainOrPattern('*.github..com')).toThrow('double dots');
    });

    it('should reject just a dot', () => {
      expect(() => validateDomainOrPattern('.')).toThrow();
    });

    it('should reject incomplete patterns', () => {
      // These are caught by the "too broad" check since they match ^[\*\.]+$
      expect(() => validateDomainOrPattern('*.')).toThrow('too broad');
      expect(() => validateDomainOrPattern('.*')).toThrow('too broad');
    });
  });

  describe('overly broad patterns', () => {
    it('should reject single asterisk', () => {
      expect(() => validateDomainOrPattern('*')).toThrow("matches all domains");
    });

    it('should reject *.*', () => {
      expect(() => validateDomainOrPattern('*.*')).toThrow("too broad");
    });

    it('should reject patterns with only wildcards and dots', () => {
      expect(() => validateDomainOrPattern('*.*.*')).toThrow("too broad");
    });

    it('should reject patterns with too many wildcard segments', () => {
      expect(() => validateDomainOrPattern('*.*.com')).toThrow("too many wildcard segments");
    });
  });
});

describe('parseDomainList', () => {
  it('should separate plain domains from patterns', () => {
    const result = parseDomainList(['github.com', '*.gitlab.com', 'example.com']);
    expect(result.plainDomains).toEqual(['github.com', 'example.com']);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].original).toBe('*.gitlab.com');
  });

  it('should convert patterns to regex', () => {
    const result = parseDomainList(['*.github.com']);
    expect(result.patterns[0].regex).toBe('^.*\\.github\\.com$');
  });

  it('should handle all plain domains', () => {
    const result = parseDomainList(['github.com', 'gitlab.com', 'example.com']);
    expect(result.plainDomains).toEqual(['github.com', 'gitlab.com', 'example.com']);
    expect(result.patterns).toHaveLength(0);
  });

  it('should handle all patterns', () => {
    const result = parseDomainList(['*.github.com', '*.gitlab.com']);
    expect(result.plainDomains).toHaveLength(0);
    expect(result.patterns).toHaveLength(2);
  });

  it('should throw on invalid pattern', () => {
    expect(() => parseDomainList(['github.com', '*'])).toThrow();
    expect(() => parseDomainList(['github..com'])).toThrow();
  });

  it('should handle empty list', () => {
    const result = parseDomainList([]);
    expect(result.plainDomains).toHaveLength(0);
    expect(result.patterns).toHaveLength(0);
  });
});

describe('isDomainMatchedByPattern', () => {
  it('should match domain against leading wildcard', () => {
    const patterns = [{ original: '*.github.com', regex: '^.*\\.github\\.com$' }];
    expect(isDomainMatchedByPattern('api.github.com', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('raw.github.com', patterns)).toBe(true);
  });

  it('should not match domain that does not fit pattern', () => {
    const patterns = [{ original: '*.github.com', regex: '^.*\\.github\\.com$' }];
    expect(isDomainMatchedByPattern('github.com', patterns)).toBe(false);
    expect(isDomainMatchedByPattern('gitlab.com', patterns)).toBe(false);
    expect(isDomainMatchedByPattern('notgithub.com', patterns)).toBe(false);
  });

  it('should match against middle wildcard', () => {
    const patterns = [{ original: 'api-*.example.com', regex: '^api-.*\\.example\\.com$' }];
    expect(isDomainMatchedByPattern('api-v1.example.com', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('api-test.example.com', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('api.example.com', patterns)).toBe(false);
  });

  it('should match against any pattern in list', () => {
    const patterns = [
      { original: '*.github.com', regex: '^.*\\.github\\.com$' },
      { original: '*.gitlab.com', regex: '^.*\\.gitlab\\.com$' },
    ];
    expect(isDomainMatchedByPattern('api.github.com', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('api.gitlab.com', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('api.bitbucket.com', patterns)).toBe(false);
  });

  it('should be case-insensitive', () => {
    const patterns = [{ original: '*.GitHub.com', regex: '^.*\\.GitHub\\.com$' }];
    expect(isDomainMatchedByPattern('API.GITHUB.COM', patterns)).toBe(true);
    expect(isDomainMatchedByPattern('api.github.com', patterns)).toBe(true);
  });

  it('should return false for empty pattern list', () => {
    expect(isDomainMatchedByPattern('api.github.com', [])).toBe(false);
  });
});
