# Security Policy

FlowAssert controls local mobile-device sessions and can expose screen content to a selected agent/model provider. Please report suspected vulnerabilities privately and minimize all device, account and host data in the report.

## Supported versions

| Version | Support |
| --- | --- |
| `0.1.0-alpha.2` candidate | Reviewed when reproducible against the pinned toolchain |
| `0.1.0-alpha.1` | Security fixes on a best-effort basis |
| Older commits, modified forks or other DSH previews | Not supported |

This project is a Developer Preview. Compatibility fixes and product support follow [SUPPORT.md](../SUPPORT.md); they are not automatically security issues.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/qmkCamel/flowassert/security/advisories/new). If that button is unavailable, contact the maintainer privately through the contact method on the [qmkCamel GitHub profile](https://github.com/qmkCamel) and ask for a secure reporting channel without including vulnerability details.

Do not open a public issue, pull request or discussion for an undisclosed vulnerability.

Include only what is necessary:

- affected FlowAssert/DSH/Appium versions and host platform;
- vulnerability class, impact and required privileges;
- a minimal Mock or synthetic reproduction when possible;
- stable error codes and a sanitized call sequence;
- suggested mitigation or disclosure constraints.

Never include real device IDs/UDIDs, serials, Apple Team IDs, bundle/signing identities, account names, Appium capabilities, host reports, provider credentials, tokens, raw logs, absolute home paths or unredacted screenshots. Use placeholders and remove metadata. If real-device evidence is essential, agree on a secure transfer method with the maintainer first.

## What happens next

Maintainers will acknowledge and triage reports as availability permits, reproduce them privately, coordinate a fix and credit the reporter when requested. Please allow time for remediation before disclosure. GitHub Security Advisories may be used for private collaboration, CVE requests and the final advisory.

If a report is not a vulnerability, it may be redirected to the public support process after confirming that the submitted material contains no sensitive information.

## Security boundaries worth reporting

- Viewer or service exposure beyond the configured loopback boundary.
- Deleting, stopping or taking ownership of Appium sessions/processes not created by FlowAssert.
- Bypassing observation freshness, screen-sharing policy or explicit provisioning/device-registration authorization.
- Returning continuous media, credentials, capabilities, signing data or unredacted host details through DSH/MCP results or logs.
- Command injection or unintended executable discovery in Doctor, onboarding, managed Appium or media runtime paths.
- Package/release integrity failures that permit an unverified artifact to be published as an official release.

Expected permission prompts, unsupported versions, unlocked-device requirements and a Doctor result that still requires physical authorization are documented product boundaries, not vulnerabilities by themselves.
