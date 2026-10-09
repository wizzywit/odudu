import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { trailFromSearch, trailToSearch, type CursorTrail } from '#/shared/service/cursorTrail.ts';

export function useCursorTrail(): {
  trail: CursorTrail;
  setTrail: (trail: CursorTrail) => void;
} {
  const { params, go } = useUrlSearch();
  return {
    trail: trailFromSearch(params),
    setTrail: (trail) => {
      go(trailToSearch(trail, params));
    },
  };
}
