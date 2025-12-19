import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadRuleSet, mergeRuleSets, RuleSet } from './rules';

describe('rules', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-rules-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads a valid ruleset file', () => {
    const filePath = path.join(tempDir, 'rules.yaml');
    fs.writeFileSync(
      filePath,
      [
        'version: 1',
        'rules:',
        '  - domain: github.com',
        '    subdomains: true',
        '  - domain: api.github.com',
      ].join('\n')
    );

    const ruleSet = loadRuleSet(filePath);

    expect(ruleSet).toEqual({
      version: 1,
      rules: [
        { domain: 'github.com', subdomains: true },
        { domain: 'api.github.com' },
      ],
    });
  });

  it('throws on unsupported fields', () => {
    const filePath = path.join(tempDir, 'rules.yaml');
    fs.writeFileSync(
      filePath,
      ['version: 1', 'rules:', '  - url: https://github.com/githubnext/*'].join('\n')
    );

    expect(() => loadRuleSet(filePath)).toThrow('Unsupported rule fields');
  });

  it('throws on invalid version', () => {
    const filePath = path.join(tempDir, 'rules.yaml');
    fs.writeFileSync(filePath, ['version: 2', 'rules:', '  - domain: github.com'].join('\n'));

    expect(() => loadRuleSet(filePath)).toThrow('Invalid ruleset version');
  });

  it('throws when domain is missing', () => {
    const filePath = path.join(tempDir, 'rules.yaml');
    fs.writeFileSync(filePath, ['version: 1', 'rules:', '  - subdomains: true'].join('\n'));

    expect(() => loadRuleSet(filePath)).toThrow('must include a non-empty "domain"');
  });

  it('merges multiple rule sets', () => {
    const sets: RuleSet[] = [
      { version: 1, rules: [{ domain: 'github.com' }, { domain: 'api.github.com' }] },
      { version: 1, rules: [{ domain: 'npmjs.org', subdomains: true }] },
    ];

    const domains = mergeRuleSets(sets);

    expect(domains).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
  });
});
