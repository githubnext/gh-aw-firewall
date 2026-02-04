#!/usr/bin/env node
/**
 * Convert npm audit JSON output to SARIF format for GitHub Security tab
 * 
 * Usage:
 *   npm audit --json | npx tsx scripts/ci/npm-audit-to-sarif.ts > results.sarif
 *   npm audit --json > audit.json && npx tsx scripts/ci/npm-audit-to-sarif.ts audit.json results.sarif
 */

import * as fs from 'fs';
import * as path from 'path';

interface NpmAuditVia {
  source?: number;
  name: string;
  severity: string;
  title: string;
  url: string;
  range?: string;
}

interface NpmAuditVulnerability {
  name: string;
  severity: string;
  isDirect: boolean;
  via: (string | NpmAuditVia)[];
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: boolean | {
    name: string;
    version: string;
    isSemVerMajor: boolean;
  };
}

interface NpmAuditReport {
  auditReportVersion: number;
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      total: number;
    };
  };
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
    region?: {
      startLine: number;
    };
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: {
    text: string;
  };
  locations: SarifLocation[];
  properties?: {
    severity: string;
    packageName: string;
    vulnerableVersionRange: string;
    fixAvailable: boolean;
  };
}

interface SarifRule {
  id: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  helpUri?: string;
  properties: {
    tags: string[];
    precision: string;
    'security-severity': string;
  };
}

interface SarifReport {
  version: '2.1.0';
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        semanticVersion: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

/**
 * Map npm severity to SARIF level
 */
function mapSeverityToLevel(severity: string): 'error' | 'warning' | 'note' {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return 'error';
    case 'moderate':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'warning';
  }
}

/**
 * Map npm severity to SARIF security-severity (0.0 to 10.0 scale)
 */
function mapSeverityToScore(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return '9.0';
    case 'high':
      return '7.0';
    case 'moderate':
      return '5.0';
    case 'low':
      return '3.0';
    case 'info':
      return '1.0';
    default:
      return '5.0';
  }
}

/**
 * Convert npm audit JSON to SARIF format
 */
function convertToSarif(npmAudit: NpmAuditReport, packageJsonPath: string = 'package.json'): SarifReport {
  const rules: SarifRule[] = [];
  const results: SarifResult[] = [];
  const ruleMap = new Map<string, number>();

  // Process each vulnerability (with null safety check)
  const vulnerabilities = npmAudit.vulnerabilities || {};
  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    // Extract advisory details from 'via' array
    const advisories = vuln.via.filter((v): v is NpmAuditVia => typeof v !== 'string');
    
    for (const advisory of advisories) {
      const ruleId = `npm-audit-${advisory.source || pkgName.replace(/[^a-zA-Z0-9-]/g, '-')}`;
      
      // Create rule if not already added
      if (!ruleMap.has(ruleId)) {
        const ruleIndex = rules.length;
        ruleMap.set(ruleId, ruleIndex);
        
        rules.push({
          id: ruleId,
          shortDescription: {
            text: advisory.title || `${vuln.severity} severity vulnerability in ${pkgName}`,
          },
          fullDescription: {
            text: `Package ${pkgName} has a ${vuln.severity} severity vulnerability. ${advisory.title || ''}. Vulnerable versions: ${vuln.range}.`,
          },
          helpUri: advisory.url,
          properties: {
            tags: ['security', 'dependency', 'npm'],
            precision: 'high',
            'security-severity': mapSeverityToScore(vuln.severity),
          },
        });
      }

      const ruleIndex = ruleMap.get(ruleId)!;
      
      // Create result for this vulnerability
      const fixMessage = vuln.fixAvailable
        ? typeof vuln.fixAvailable === 'object'
          ? ` A fix is available by upgrading to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}.`
          : ' A fix is available.'
        : ' No fix is currently available.';

      results.push({
        ruleId,
        ruleIndex,
        level: mapSeverityToLevel(vuln.severity),
        message: {
          text: `${advisory.title || `Vulnerability in ${pkgName}`}${fixMessage}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: packageJsonPath,
              },
              region: {
                startLine: 1,
              },
            },
          },
        ],
        properties: {
          severity: vuln.severity,
          packageName: pkgName,
          vulnerableVersionRange: vuln.range,
          fixAvailable: !!vuln.fixAvailable,
        },
      });
    }
  }

  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'npm audit',
            informationUri: 'https://docs.npmjs.com/cli/v10/commands/npm-audit',
            semanticVersion: '1.0.0',
            rules,
          },
        },
        results,
      },
    ],
  };
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  let inputData = '';
  let outputFile: string | null = null;

  // Parse command line arguments
  if (args.length === 0) {
    // Read from stdin
    inputData = fs.readFileSync(0, 'utf-8');
  } else if (args.length === 1) {
    // Read from file
    inputData = fs.readFileSync(args[0], 'utf-8');
  } else if (args.length === 2) {
    // Read from file and write to output file
    inputData = fs.readFileSync(args[0], 'utf-8');
    outputFile = args[1];
  } else {
    console.error('Usage: npm-audit-to-sarif.ts [input.json] [output.sarif]');
    process.exit(1);
  }

  try {
    const npmAudit: NpmAuditReport = JSON.parse(inputData);
    
    // Determine package.json path based on input file location
    let packageJsonPath = 'package.json';
    if (args[0] && args[0] !== '-') {
      const inputDir = path.dirname(args[0]);
      packageJsonPath = path.join(inputDir, 'package.json');
      // Make path relative to current working directory for SARIF
      packageJsonPath = path.relative(process.cwd(), packageJsonPath) || 'package.json';
    }
    
    const sarif = convertToSarif(npmAudit, packageJsonPath);
    const sarifJson = JSON.stringify(sarif, null, 2);

    if (outputFile) {
      fs.writeFileSync(outputFile, sarifJson);
      console.error(`SARIF report written to ${outputFile}`);
    } else {
      console.log(sarifJson);
    }
  } catch (error) {
    console.error('Error converting npm audit to SARIF:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { convertToSarif, NpmAuditReport, SarifReport };
