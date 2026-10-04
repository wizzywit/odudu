// One step of the way up from a page; a step with no href is a heading,
// such as a rail group, rather than a page.
export interface Crumb {
  label: string;
  href?: string;
}
