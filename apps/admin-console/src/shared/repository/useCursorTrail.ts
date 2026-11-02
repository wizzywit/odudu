import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { trailFromSearch, trailToSearch, type CursorTrail } from '#/shared/services/cursorTrail';

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
