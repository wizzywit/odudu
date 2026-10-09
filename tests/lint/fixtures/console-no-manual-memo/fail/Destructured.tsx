import React from 'react';

const { useCallback: stable } = React;

export function Button({ onPress }: { onPress: () => void }) {
  const press = stable(() => {
    onPress();
  }, [onPress]);
  return <button onClick={press}>Go</button>;
}
