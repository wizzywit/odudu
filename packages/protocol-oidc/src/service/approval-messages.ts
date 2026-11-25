// The wording an approval's stored summary and its page share, keyed by what it
// is for. The page shows its own locale's version of the same key; the stored
// text is the English one, for the admin API and the console, which show it as
// it was written.
export const APPROVAL_MESSAGES = {
  'approval.asks': '{agent} asks to sign in as you with: {scope}',
} as const;

export function cibaApprovalSummary(agent: string, scopes: readonly string[]): string {
  const values: Record<string, string> = { agent, scope: scopes.join(' ') };
  return APPROVAL_MESSAGES['approval.asks'].replace(/\{(agent|scope)\}/gu, (_, key: string) => {
    return values[key] ?? '';
  });
}
