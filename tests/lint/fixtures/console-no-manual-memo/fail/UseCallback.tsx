export function Button({ onPress }: { onPress: () => void }) {
  const press = React.useCallback(() => {
    onPress();
  }, [onPress]);
  return <button onClick={press}>Go</button>;
}
