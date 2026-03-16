# container-runtime

- Source file: `src/container-runtime.ts`
- Responsibility: resolve effective runtime (`docker` or `host`) with explicit host opt-in guardrails.

## Exported API

```ts
export type ContainerRuntime = 'docker' | 'host';
export function getContainerRuntime(): ContainerRuntime;
```

## Environment Variables Referenced

- `CONTAINER_RUNTIME`
- `FFT_NANO_ALLOW_HOST_RUNTIME`

## Behavior Summary

- `CONTAINER_RUNTIME=docker` -> docker runtime.
- `CONTAINER_RUNTIME=host` -> host runtime only when `FFT_NANO_ALLOW_HOST_RUNTIME=1`; otherwise throws.
- `CONTAINER_RUNTIME=auto`:
  - use docker when available
  - otherwise use host only with explicit allow flag
  - otherwise throw with remediation guidance

## Notable Internal Symbol

```ts
function commandExists(cmd: string): boolean;
```
