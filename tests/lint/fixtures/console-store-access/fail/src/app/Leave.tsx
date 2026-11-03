import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { useToasts } from '#/shared/lib/repository/useToasts';

export function Leave() {
  const { forgetAll } = useDrafts.getState();
  forgetAll();
  return null;
}

export function Everything() {
  const queue = useToasts();
  return <p>{queue.toasts.length}</p>;
}

export function Whole() {
  const count = useDrafts().count;
  return <p>{count}</p>;
}
