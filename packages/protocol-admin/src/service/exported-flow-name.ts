// A client's flow is exported by name. A flow the tenant does not hold cannot
// happen under the foreign key, and exporting it as "follows the default"
// would put the client on the default when the document is imported.
export function exportedFlowName(
  names: ReadonlyMap<string, string>,
  flowId: string | null,
  clientId: string,
  tenantId: string,
): string | null {
  if (flowId === null) return null;
  const name = names.get(flowId);
  if (name === undefined) {
    throw new Error(
      `client ${clientId} of tenant ${tenantId} names flow ${flowId}, which the tenant does not hold`,
    );
  }
  return name;
}
