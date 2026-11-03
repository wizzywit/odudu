import { useVanilla } from '#/shared/lib/repository/vanilla';

export function UsesVanilla() {
  useVanilla.getState().go();
  return null;
}
