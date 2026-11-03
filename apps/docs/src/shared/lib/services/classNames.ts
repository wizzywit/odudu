// Joins the class names that are present, in order.
export function classNames(...names: (string | undefined)[]): string {
  return names.filter((name) => name !== undefined && name !== '').join(' ');
}
