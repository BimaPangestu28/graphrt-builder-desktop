# Security policy

graphrt desktop stores model provider keys, connects to apps such as Gmail and
WhatsApp, and will run agents on your computer. We take security reports seriously.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/BimaPangestu28/graphrt-builder-desktop/security/advisories/new).

Please include:

- the app version and your operating system,
- steps to reproduce,
- the impact you see (secret disclosure, code execution, data loss...).

We aim to acknowledge reports within 3 working days and to ship a fix or
mitigation for confirmed high-severity issues within 30 days. We credit
reporters in the release notes unless you prefer otherwise.

## Supported versions

Until 1.0, only the latest minor release receives security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## Scope

In scope, for example:

- API keys or other secrets appearing in logs, exported files, the web view or
  error messages;
- loosening of the content security policy, or remote content able to call
  Tauri commands;
- path traversal or unexpected file access through the desktop shell.

Vulnerabilities in the agent runtime itself belong to
[graphrt](https://github.com/BimaPangestu28/graphrt/security).
