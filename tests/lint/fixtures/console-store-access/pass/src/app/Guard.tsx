import { useEffect } from 'react';
import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { useToasts } from '#/shared/lib/repository/useToasts';

export function Guard() {
  const keep = useDrafts((drafts) => drafts.keep);
  useEffect(() => {
    const unload = (event: Event): void => {
      const { count } = useDrafts.getState();
      if (count > 0) event.preventDefault();
    };
    const off = useToasts.subscribe(() => undefined);
    window.addEventListener('beforeunload', unload);
    return () => {
      off();
      window.removeEventListener('beforeunload', unload);
    };
  }, [keep]);
  return null;
}
