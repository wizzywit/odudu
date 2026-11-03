import { useToasts } from '#/shared/lib/repository/useToasts';

export default function () {
  useToasts.getState().push('a');
  return null;
}
