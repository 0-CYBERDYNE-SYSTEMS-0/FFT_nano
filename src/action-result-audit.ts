export interface ActionResultAuditInput {
  result: object;
  request: object;
  sourceGroup: string;
  isMain: boolean;
}

export function attachActionRequestAudit(
  input: ActionResultAuditInput,
): Record<string, unknown> {
  const result = input.result as Record<string, unknown>;
  return {
    ...result,
    audit: {
      ...(typeof result.audit === 'object' &&
      result.audit !== null &&
      !Array.isArray(result.audit)
        ? (result.audit as Record<string, unknown>)
        : {}),
      ipcRequest: input.request,
      sourceGroup: input.sourceGroup,
      isMain: input.isMain,
      recordedAt: new Date().toISOString(),
    },
  };
}
