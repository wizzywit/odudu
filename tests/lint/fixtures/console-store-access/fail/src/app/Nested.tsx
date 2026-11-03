import { useDrafts } from '#/shared/lib/repository/useDrafts';

export function Nested() {
  return (
    <button
      onClick={() => {
        useDrafts.getState().keep();
      }}
    >
      keep
    </button>
  );
}
