export interface AdminEmailChangeInput {
  /** The address the request names, or null to remove the address. */
  readonly asked: string | null;
  /** The subject holding `asked` in any case, or null when nobody does. */
  readonly holder: string | null;
  readonly subjectId: string;
}

export type AdminEmailPlan =
  | { readonly kind: 'clear' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'confirm'; readonly address: string };

// An address another subject holds is refused before this is called.
export function planAdminEmailChange(input: AdminEmailChangeInput): AdminEmailPlan {
  if (input.asked === null) return { kind: 'clear' };
  if (input.holder === input.subjectId) return { kind: 'cancel' };
  return { kind: 'confirm', address: input.asked };
}
