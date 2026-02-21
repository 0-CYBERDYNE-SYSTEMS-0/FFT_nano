# Testing and Release

## Local Validation Commands

Defined in `package.json`:
- `npm run typecheck`
- `npm test`
- `npm run validate:skills`
- `npm run secret-scan`
- `npm run pack-check`

Release bundle check:
- `npm run release-check`

`release-check.sh` runs, in order:
1. skill validation
2. typecheck
3. tests
4. secret scan
5. npm pack content policy check

## Test Coverage Areas

Current tests (`tests/*.test.ts`) cover:
- coding delegation trigger parsing
- DB FTS migration behavior
- memory action gateway permissions and behavior
- memory maintenance migration/append behavior
- memory path safety and scaffold
- retrieval dedupe behavior
- pi skill validation/sync behavior
- telegram text splitting and markdown->HTML formatting

## Build and Runtime Scripts

Setup:
- `./scripts/setup.sh`

Start runtime:
- `./scripts/start.sh start`
- `./scripts/start.sh dev`
- optional `telegram-only` flag

Container image builds:
- Apple Container: `./container/build.sh`
- Docker: `./container/build-docker.sh`

WhatsApp auth:
- `npm run auth`

Farm flows:
- `./scripts/farm-bootstrap.sh --mode demo|production ...`
- `./scripts/farm-onboarding.sh`
- `./scripts/farm-validate.sh`
- `./scripts/farm-demo.sh`

## Documentation Maintenance Recommendation

When changing host runtime behavior, update at minimum:
- relevant deep-dive page in `docs-site/developer/`
- corresponding module page in `docs-site/developer/modules/`
- command/IPC examples if affected
