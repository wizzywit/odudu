import { useNavigate } from '@tanstack/react-router';

// Through the router, so the unsaved-changes guard is asked first.
export function useGo(): (href: string) => void {
  const navigate = useNavigate();
  return (href) => {
    navigate({ href }).catch(() => undefined);
  };
}
