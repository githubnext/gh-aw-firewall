# DLP (Data Loss Prevention)

The `--enable-dlp` flag enables Data Loss Prevention scanning to detect and block sensitive data patterns in outgoing HTTP requests.

## Overview

DLP inspection scans URLs, query strings, and path segments for patterns matching sensitive credentials such as:

- **GitHub tokens** (`ghp_`, `gho_`, `ghs_`, `ghr_`, `github_pat_`)
- **OpenAI API keys** (`sk-...`)
- **AWS access keys** (`AKIA...`)
- **Generic patterns** (`api_key=...`, `token=...`, `secret=...`)

When a sensitive pattern is detected, the request is blocked with HTTP 403 Forbidden.

## Usage

```bash
# Enable DLP scanning for HTTP traffic
sudo awf --allow-domains github.com --enable-dlp -- curl https://api.github.com

# For HTTPS content inspection, combine with SSL Bump
sudo awf --allow-domains github.com --enable-dlp --ssl-bump -- curl https://api.github.com
```

## Detected Patterns

| Pattern Type | Example | Description |
|-------------|---------|-------------|
| GitHub PAT | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Personal access tokens |
| GitHub OAuth | `gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | OAuth access tokens |
| GitHub Server | `ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Server-to-server tokens |
| GitHub Refresh | `ghr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Refresh tokens |
| GitHub Fine-grained | `github_pat_...` | Fine-grained personal access tokens |
| OpenAI API Key | `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | OpenAI API keys |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | AWS access key IDs |
| Generic API Key | `api_key=...`, `apiKey=...` | Query string API keys |
| Generic Token | `token=...`, `access_token=...` | Query string tokens |
| Generic Secret | `secret=...`, `client_secret=...` | Query string secrets |

## How It Works

DLP uses Squid's `url_regex` ACL type to scan request URLs for sensitive patterns. When a pattern is matched:

1. The request is blocked before being forwarded
2. HTTP 403 Forbidden is returned to the client
3. The block is logged in Squid access logs

## Limitations

- **URL-based detection only**: DLP scans URLs, query strings, and path segments. Request bodies (POST data) are not inspected without ICAP integration.
- **HTTP vs HTTPS**: For HTTPS traffic, URL paths are only visible when `--ssl-bump` is enabled. Without SSL Bump, only the domain (via SNI) can be inspected for HTTPS.
- **False positives**: Generic patterns may occasionally match non-sensitive data. Review blocked requests if legitimate traffic is affected.

## Combining with SSL Bump

For comprehensive HTTPS inspection:

```bash
sudo awf --allow-domains github.com \
  --enable-dlp \
  --ssl-bump \
  -- your-command
```

This enables:
- Full URL path inspection for HTTPS requests
- DLP pattern matching on HTTPS URLs and query parameters

> **Note**: SSL Bump intercepts HTTPS traffic. Only use for trusted workloads.

## Example: Blocking a Token in URL

```bash
# This request will be blocked
sudo awf --allow-domains api.example.com --enable-dlp \
  -- curl "https://api.example.com/data?token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Result: Request blocked with 403 Forbidden.

## Performance Impact

DLP adds minimal overhead:
- Pattern matching is performed using Squid's built-in regex ACLs
- No external service calls required
- Expected latency increase: < 10% for typical requests

## Security Considerations

- DLP provides defense-in-depth against credential exfiltration
- It complements domain whitelisting but does not replace it
- For maximum protection, combine with `--ssl-bump` for HTTPS inspection
- Monitor logs for blocked requests to detect potential exfiltration attempts
