# mount-security

- Source file: src/mount-security.ts
- Lines: 413
- Responsibility: External mount allowlist loading and additional mount validation.

## Exported API

```ts
export function loadMountAllowlist(): MountAllowlist | null {
export interface MountValidationResult {
export function validateMount(
export function validateAdditionalMounts(
export function generateAllowlistTemplate(): string {
```

## Environment Variables Referenced

- HOME
- LOG_LEVEL

## Notable Internal Symbols

```ts
function expandPath(p: string): string {
function getRealPath(p: string): string | null {
function matchesBlockedPattern(
function findAllowedRoot(
function isValidContainerPath(containerPath: string): boolean {
```
