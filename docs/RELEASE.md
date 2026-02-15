# Release Process

This project uses **GitHub Releases** as the official distribution channel.
`npm install` is not the primary install path for end users at this time.

## Versioning

Use SemVer (`X.Y.Z`) and keep `package.json` aligned with release tags (`vX.Y.Z`).

- `MAJOR`: breaking runtime/config/API behavior
- `MINOR`: backwards-compatible features
- `PATCH`: fixes/docs/refactors without breaking behavior

## Pre-Release Checklist

Run this from repo root:

```bash
npm ci
npm run release-check
```

`release-check` runs:

- `npm run validate:skills`
- `npm run typecheck`
- `npm test`
- `npm run secret-scan`

## Cut a Release

1. Bump version in `package.json` (and lockfile) to target SemVer.
2. Commit the version bump.
3. Tag the release commit:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

4. Generate SHA256 checksums for GitHub source archives:

```bash
./scripts/release/generate-sha256s.sh vX.Y.Z
```

5. Create GitHub Release from tag:

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file .github/release-template.md \
  dist/release/vX.Y.Z/SHA256SUMS
```

GitHub automatically provides source `.tar.gz` and `.zip` assets for the tag.
Attach `SHA256SUMS` so users can verify downloads.

## Release Notes Sections

Use these sections in every release:

- What changed
- Breaking changes (if any)
- Upgrade steps
- Known issues

## npm Policy

Do not position npm as the primary install path yet.

Revisit npm distribution after:

- dedicated CLI entrypoint (`bin`)
- explicit package file allowlist (`files` or `.npmignore`)
- install-time behavior policy
- end-user install docs for global/local modes
