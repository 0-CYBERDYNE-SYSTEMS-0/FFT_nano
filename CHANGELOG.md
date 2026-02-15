# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-02-15

### Added

- Release readiness workflow with secret scanning and release checks.
- Local release scripts (`secret-scan`, `release-check`, checksum generation).
- GitHub release template and release process documentation.

### Changed

- Canonicalized skill paths to `skills/setup` and `skills/runtime`.
- Updated skill PR workflow to validate `skills/` paths.

### Security

- Added tracked-file secret scanning gate.
- Added pack-content policy checks to prevent shipping local runtime/state files.

## [1.0.0] - 2026-02-15

### Added

- First public release baseline.
