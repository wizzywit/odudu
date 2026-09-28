export function PlainProps({ title, onPress }: { title: string; onPress?: () => void }) {
  return <button onClick={onPress}>{title}</button>;
}
