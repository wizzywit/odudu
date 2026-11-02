// A search reaches every level of the tree; without one the list is its top.
export function groupListScope(search: string | null): {
  searching: boolean;
  fixed: Readonly<Record<string, string>>;
} {
  const searching = (search ?? '') !== '';
  return { searching, fixed: searching ? {} : { parent: 'root' } };
}
