# Security Policy

This tool runs locally and normally handles source code that never leaves your machine.

**Please do not open a public issue for a vulnerability.** Report it privately through GitHub Security Advisories on this repository, or email the maintainer listed on the GitHub profile.

Useful details to include: affected version/commit, reproduction steps, and the impact you believe it has.

Scope worth reporting:

- Bypassing the `127.0.0.1` binding, Host/Origin checks or session token.
- Path traversal or reading files outside the indexed project root.
- Bypassing the change-task baseline or the re-scan verification.
- Arbitrary write outside `.project-map/`.

Not in scope: findings that require an already-compromised local machine, and the documented limits (static analysis only, no runtime call graph).
