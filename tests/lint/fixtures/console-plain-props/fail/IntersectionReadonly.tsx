interface BaseProps {
  label: string;
}

export function IntersectionReadonly({ label, isOpen }: BaseProps & { readonly isOpen: boolean }) {
  return isOpen ? <span>{label}</span> : null;
}
