# Release Process

This is the canonical release flow for `FFT_nano`.

`main` is the public release branch.
`dev` is the pre-release integration branch.

## Release Gate

Run the full gate from the release candidate branch before promoting anything:

```bash
npm run release-check
git diff --check
git status --short
```

Expected:

- `release-check` passes
- no whitespace or merge-marker issues
- clean working tree before branch promotion and tagging

## OSS Hygiene

Before a public release, confirm:

- no `.env` or `.env.*` files are tracked except `.env.example`
- no certs, private keys, or personal runtime state are tracked
- no personal absolute paths or real chat identifiers are present in tracked files
- `npm pack --dry-run` excludes local runtime/state paths such as `groups/`, `data/`, `logs/`, `store/`, `tmp-ipc/`, and `.env`

The repo already enforces this with:

- `scripts/secret-scan.sh`
- `.gitleaks.toml`
- `.gitignore`
- `scripts/check-pack-contents.sh`

## Release Steps

1. Update release metadata:
   - bump version in `package.json` and `package-lock.json`
   - add the new version entry to `CHANGELOG.md`
2. Run the full release gate:

```bash
npm run release-check
```

3. Fast-forward `main` from the tested `dev` tip:

```bash
git checkout main
git pull --ff-only origin main
git merge --ff-only origin/dev
git push origin main
```

4. Create and push the annotated tag:

```bash
git tag -a vX.Y.Z -m "FFT_nano vX.Y.Z"
git push origin vX.Y.Z
```

5. Publish the GitHub release from that tag:
   - use `.github/release-template.md` as the structure
   - summarize operator-visible changes
   - include upgrade steps and known issues
   - publish as a stable release, not a prerelease

## Release Notes Expectations

Every release should include:

- `What Changed`
- `Breaking Changes`
- `Upgrade Steps`
- `Known Issues`

Use `Breaking Changes: None` only when there is truly no operator action or migration caveat to note.

## Checksums

If you want source-archive checksums for the GitHub release, generate them after the tag exists:

```bash
npm run release:sha256 -- vX.Y.Z
```

This writes checksum artifacts under `dist/release/vX.Y.Z/`.
