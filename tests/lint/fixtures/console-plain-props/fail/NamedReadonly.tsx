interface NamedReadonlyProps {
  readonly title: string;
}

export function NamedReadonly({ title }: NamedReadonlyProps) {
  return <span>{title}</span>;
}
