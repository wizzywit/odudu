// Where a subject has its page, for a caller who may read subjects, or none.
export function subjectLinkOf(
  mayRead: boolean,
  tenant: string,
  href: (tenant: string, id: string) => string,
): ((id: string) => string) | null {
  return mayRead ? (id) => href(tenant, id) : null;
}
