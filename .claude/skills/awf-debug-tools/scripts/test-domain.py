#!/usr/bin/env python3
"""
Test if specific domain is reachable through awf firewall.
Checks allowlist and Squid logs to determine status.
"""

import sys
import os
import argparse
from typing import Dict, Optional

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(__file__))
import common


def check_allowlist(domain: str) -> tuple[bool, Optional[str]]:
    """
    Check if domain is in Squid allowlist.

    Returns:
        Tuple of (in_allowlist, matched_pattern)
    """
    config = common.read_squid_config()
    if config is None:
        return (False, None)

    allowed_domains = common.get_allowed_domains(config)

    # Check exact match
    if domain in allowed_domains:
        return (True, domain)

    # Check subdomain match
    # If allowlist has "github.com" or ".github.com", it matches "api.github.com"
    for pattern in allowed_domains:
        if pattern.startswith('.'):
            # .github.com matches api.github.com
            if domain.endswith(pattern) or domain.endswith(pattern[1:]):
                return (True, pattern)
        else:
            # github.com matches api.github.com
            if domain == pattern or domain.endswith('.' + pattern):
                return (True, pattern)

    return (False, None)


def check_logs(domain: str) -> Optional[Dict]:
    """
    Check Squid logs for domain.

    Returns:
        Dict with status info or None if not found
    """
    log_path = common.find_squid_logs()
    if log_path is None:
        return None

    lines = common.read_squid_logs(log_path)

    # Find most recent entry for this domain
    last_entry = None
    for line in lines:
        entry = common.parse_squid_log_line(line)
        if entry and domain in entry['domain']:
            last_entry = entry

    if last_entry:
        return {
            'found': True,
            'allowed': last_entry['is_allowed'],
            'status_code': last_entry['status_code'],
            'decision': last_entry['decision']
        }

    return None


def test_domain(domain: str, check_allowlist_only: bool, suggest_fix: bool) -> Dict:
    """
    Test domain reachability.

    Returns:
        Dict with test results
    """
    result = {
        'domain': domain,
        'in_allowlist': False,
        'matched_pattern': None,
        'in_logs': False,
        'log_status': None,
        'status': 'unknown',
        'suggestion': None
    }

    # Check allowlist
    in_allowlist, matched_pattern = check_allowlist(domain)
    result['in_allowlist'] = in_allowlist
    result['matched_pattern'] = matched_pattern

    # Check logs (unless --check-allowlist)
    if not check_allowlist_only:
        log_result = check_logs(domain)
        if log_result:
            result['in_logs'] = True
            result['log_status'] = {
                'allowed': log_result['allowed'],
                'status_code': log_result['status_code'],
                'decision': log_result['decision']
            }

    # Determine overall status
    if in_allowlist:
        if result['in_logs'] and result['log_status']:
            if result['log_status']['allowed']:
                result['status'] = 'ALLOWED'
            else:
                result['status'] = 'BLOCKED'
        else:
            result['status'] = 'ALLOWED (in allowlist)'
    else:
        if result['in_logs'] and result['log_status']:
            if result['log_status']['allowed']:
                result['status'] = 'ALLOWED (unexpected)'
            else:
                result['status'] = 'BLOCKED'
        else:
            result['status'] = 'NOT TESTED'

    # Generate suggestion
    if suggest_fix and not in_allowlist:
        # Check if we can infer existing domains
        config = common.read_squid_config()
        if config:
            allowed = common.get_allowed_domains(config)
            if allowed:
                suggestion = f"awf --allow-domains {','.join(allowed)},{domain} 'your-command'"
            else:
                suggestion = f"awf --allow-domains {domain} 'your-command'"
        else:
            suggestion = f"awf --allow-domains {domain} 'your-command'"

        result['suggestion'] = suggestion

    return result


def format_text_output(result: Dict) -> str:
    """Format results as text."""
    lines = []
    lines.append(f"Testing: {result['domain']}")
    lines.append("")

    # Allowlist check
    if result['in_allowlist']:
        pattern = result['matched_pattern']
        match_str = f"'{pattern}'"
        if pattern != result['domain']:
            match_str += " (subdomain matching)"
        lines.append(f"[✓] Allowlist check: Matched by {match_str}")
    else:
        lines.append(f"[✗] Allowlist check: Not in allowlist")

    # Log check
    if result['in_logs']:
        log_status = result['log_status']
        if log_status['allowed']:
            lines.append(f"[✓] Reachability: Found in logs ({log_status['status_code']} {log_status['decision']})")
        else:
            lines.append(f"[✗] Reachability: Blocked ({log_status['status_code']} {log_status['decision']})")
    else:
        if result['in_allowlist']:
            lines.append(f"[?] Reachability: No logs found (not tested yet)")
        else:
            lines.append(f"[?] Reachability: Not tested (not in allowlist)")

    # Status
    status_emoji = "✓" if "ALLOWED" in result['status'] else "✗"
    lines.append(f"[{status_emoji}] Status: {result['status']}")
    lines.append("")

    # Suggestion
    if result['suggestion']:
        lines.append("Suggested fix:")
        lines.append(f"  {result['suggestion']}")
    elif result['status'] == 'ALLOWED':
        lines.append("No action needed.")
    elif result['status'] == 'NOT TESTED':
        lines.append(f"To test: awf --allow-domains {result['domain']} 'curl https://{result['domain']}'")

    return "\n".join(lines)


def format_json_output(result: Dict) -> str:
    """Format results as JSON."""
    return common.format_json(result, pretty=True)


def main():
    parser = argparse.ArgumentParser(
        description='Test if domain is reachable through awf firewall',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test allowed domain
  %(prog)s github.com

  # Test blocked domain
  %(prog)s example.com

  # Only check allowlist
  %(prog)s api.github.com --check-allowlist

  # Show fix suggestion
  %(prog)s npmjs.org --suggest-fix

  # JSON output
  %(prog)s github.com --format json
        """
    )

    parser.add_argument(
        'domain',
        help='Domain to test (e.g., github.com)'
    )
    parser.add_argument(
        '--check-allowlist',
        action='store_true',
        help='Only check allowlist, don\'t check logs'
    )
    parser.add_argument(
        '--suggest-fix',
        action='store_true',
        help='Show suggested --allow-domains flag'
    )
    parser.add_argument(
        '--format',
        choices=['text', 'json'],
        default='text',
        help='Output format (default: text)'
    )

    args = parser.parse_args()

    # Test domain
    result = test_domain(args.domain, args.check_allowlist, args.suggest_fix)

    # Output
    if args.format == 'json':
        print(format_json_output(result))
    else:
        print(format_text_output(result))

    # Exit code: 0 if allowed, 1 if blocked/not in allowlist
    is_allowed = 'ALLOWED' in result['status']
    sys.exit(0 if is_allowed else 1)


if __name__ == '__main__':
    main()
