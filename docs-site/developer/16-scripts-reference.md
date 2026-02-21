# Scripts Reference

This page covers repository scripts under `scripts/` and `container/`.

## Setup and Start

- `scripts/setup.sh`
  - validates node/runtime prerequisites
  - installs deps
  - typecheck + build
  - builds container image
  - scaffolds `.env` and mount allowlist if missing

- `scripts/start.sh [start|dev] [telegram-only]`
  - loads `.env` if present
  - optional Telegram-only mode sets `WHATSAPP_ENABLED=0`
  - prints runtime mode summary and starts host process

## Auth

- `npm run auth` -> `src/whatsapp-auth.ts`

## Skills

- `scripts/validate-pi-skills.ts`
  - validates required runtime skill directories and guardrails

## Farm flows

- `scripts/farm-bootstrap.sh`
  - orchestrates demo/production onboarding
  - syncs companion dashboard repo
  - writes farm env vars

- `scripts/farm-demo.sh`
  - validates demo path and telemetry simulator

- `scripts/farm-onboarding.sh`
  - interactive required-entity mapping to profile JSON

- `scripts/farm-validate.sh`
  - validates profile mappings, HA service availability, and dashboard path

## Release and hygiene

- `scripts/release-check.sh`
- `scripts/check-pack-contents.sh`
- `scripts/secret-scan.sh`
- `scripts/release/generate-sha256s.sh`

## Container image builds

- `container/build.sh [tag]` (Apple Container)
- `container/build-docker.sh [tag]` (Docker)
