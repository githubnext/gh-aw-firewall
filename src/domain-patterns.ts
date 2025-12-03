/**
 * Domain pattern utilities for wildcard support in --allow-domains
 *
 * Supports asterisk (*) wildcards that are converted to Squid dstdom_regex ACLs.
 * Examples:
 *   *.github.com      -> matches api.github.com, raw.github.com, etc.
 *   api-*.example.com -> matches api-v1.example.com, api-test.example.com, etc.
 */

/**
 * Check if a domain string contains wildcard characters
 */
export function isWildcardPattern(domain: string): boolean {
  return domain.includes('*');
}

/**
 * Convert a wildcard pattern to a Squid-compatible regex pattern
 *
 * @param pattern - Domain pattern with asterisk wildcards
 * @returns Anchored regex string for use with dstdom_regex
 * @throws Error if pattern is invalid
 *
 * Conversion rules:
 * - `*` becomes `.*` (match any characters)
 * - `.` becomes `\.` (literal dot)
 * - Other regex metacharacters are escaped
 * - Result is anchored with `^` and `$`
 */
export function wildcardToRegex(pattern: string): string {
  // Escape regex metacharacters except for *
  // Order matters: escape backslash first
  let regex = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    switch (char) {
      case '*':
        regex += '.*';
        break;
      case '.':
        regex += '\\.';
        break;
      // Escape other regex metacharacters
      case '^':
      case '$':
      case '+':
      case '?':
      case '{':
      case '}':
      case '[':
      case ']':
      case '|':
      case '(':
      case ')':
      case '\\':
        regex += '\\' + char;
        break;
      default:
        regex += char;
        break;
    }
  }

  // Anchor the regex to match the full domain
  return '^' + regex + '$';
}

/**
 * Validate a domain or wildcard pattern
 *
 * @param input - Domain or pattern to validate
 * @throws Error if the input is invalid or too broad
 */
export function validateDomainOrPattern(input: string): void {
  // Check for empty input
  if (!input || input.trim() === '') {
    throw new Error('Domain cannot be empty');
  }

  const trimmed = input.trim();

  // Check for overly broad patterns
  if (trimmed === '*') {
    throw new Error("Pattern '*' matches all domains and is not allowed");
  }

  if (trimmed === '*.*') {
    throw new Error("Pattern '*.*' is too broad and is not allowed");
  }

  // Check for patterns that are essentially "match all"
  // e.g., *.* with only wildcards and dots
  if (/^[*.]+$/.test(trimmed) && trimmed.includes('*')) {
    throw new Error(`Pattern '${trimmed}' is too broad and is not allowed`);
  }

  // Check for double dots
  if (trimmed.includes('..')) {
    throw new Error(`Invalid domain '${trimmed}': contains double dots`);
  }

  // Check for patterns starting or ending with just a dot
  if (trimmed === '.') {
    throw new Error('Invalid domain: cannot be just a dot');
  }

  // Check for invalid leading/trailing patterns
  if (trimmed === '*.' || trimmed === '.*') {
    throw new Error(`Invalid pattern '${trimmed}': incomplete domain`);
  }

  // Check for wildcard-only segments between dots that could match anything
  // e.g., "*.*.com" is too broad (matches any.thing.com)
  // But "*.github.com" is fine (matches anything.github.com)
  const segments = trimmed.split('.');
  const wildcardSegments = segments.filter(s => s === '*').length;
  const totalSegments = segments.length;

  // If more than half the segments are pure wildcards, it's probably too broad
  // Exception: *.domain.tld is fine (1 wildcard, 3 segments)
  if (wildcardSegments > 1 && wildcardSegments >= totalSegments - 1) {
    throw new Error(
      `Pattern '${trimmed}' has too many wildcard segments and is not allowed`
    );
  }
}

export interface DomainPattern {
  original: string;
  regex: string;
}

export interface ParsedDomainList {
  plainDomains: string[];
  patterns: DomainPattern[];
}

/**
 * Parse and categorize domains into plain domains and wildcard patterns
 *
 * @param domains - Array of domain strings (may include wildcards)
 * @returns Object with plainDomains and patterns arrays
 * @throws Error if any domain/pattern is invalid
 */
export function parseDomainList(domains: string[]): ParsedDomainList {
  const plainDomains: string[] = [];
  const patterns: DomainPattern[] = [];

  for (const domain of domains) {
    // Validate each domain/pattern
    validateDomainOrPattern(domain);

    if (isWildcardPattern(domain)) {
      patterns.push({
        original: domain,
        regex: wildcardToRegex(domain),
      });
    } else {
      plainDomains.push(domain);
    }
  }

  return { plainDomains, patterns };
}

/**
 * Check if a plain domain would be matched by any of the wildcard patterns
 *
 * Used to remove redundant plain domains when a pattern already covers them.
 *
 * @param domain - Plain domain to check
 * @param patterns - Array of wildcard patterns with their regex
 * @returns true if the domain matches any pattern
 */
export function isDomainMatchedByPattern(
  domain: string,
  patterns: DomainPattern[]
): boolean {
  for (const pattern of patterns) {
    try {
      // Use case-insensitive matching (DNS is case-insensitive)
      const regex = new RegExp(pattern.regex, 'i');
      if (regex.test(domain)) {
        return true;
      }
    } catch {
      // Invalid regex, skip this pattern
      continue;
    }
  }
  return false;
}
