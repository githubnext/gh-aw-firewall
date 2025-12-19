import * as fs from 'fs';
import { load } from 'js-yaml';

export interface Rule {
  domain?: string;
  subdomains?: boolean;
  url?: string; // Future: requires TLS inspection
  methods?: string[]; // Future: requires TLS inspection
}

export interface RuleSet {
  version: number;
  rules: Rule[];
}

function validateRuleSet(ruleSet: unknown, source: string): RuleSet {
  if (!ruleSet || typeof ruleSet !== 'object') {
    throw new Error(`Invalid ruleset in ${source}: expected an object`);
  }

  const { version, rules } = ruleSet as Record<string, unknown>;

  if (version !== 1) {
    throw new Error(`Invalid ruleset version in ${source}: expected version 1`);
  }

  if (!Array.isArray(rules)) {
    throw new Error(`Invalid ruleset in ${source}: "rules" must be an array`);
  }

  const sanitizedRules = rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Invalid rule at index ${index} in ${source}: expected an object`);
    }

    const { domain, subdomains, url, methods } = rule as Rule & Record<string, unknown>;

    if (url !== undefined || methods !== undefined) {
      throw new Error(
        `Unsupported rule fields in ${source} (rule ${index + 1}): only "domain" and "subdomains" are supported`
      );
    }

    if (typeof domain !== 'string' || domain.trim() === '') {
      throw new Error(`Rule ${index + 1} in ${source} must include a non-empty "domain" string`);
    }

    if (subdomains !== undefined && typeof subdomains !== 'boolean') {
      throw new Error(`Rule ${index + 1} in ${source} has invalid "subdomains" value (must be boolean)`);
    }

    return {
      domain: domain.trim(),
      subdomains,
    };
  });

  return { version: 1, rules: sanitizedRules };
}

export function loadRuleSet(filePath: string): RuleSet {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ruleset file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = load(content);

  return validateRuleSet(parsed, filePath);
}

export function mergeRuleSets(sets: RuleSet[]): string[] {
  return sets.flatMap(set =>
    set.rules
      .map(rule => rule.domain)
      .filter((domain): domain is string => Boolean(domain))
  );
}
