import { useNavigate } from '@tanstack/react-router';

// Through the router, so the unsaved-changes guard is asked first. A page
// that has done its work, such as a creation, is replaced rather than kept.
export function useGo(): (href: string, options?: { replace?: boolean }) => void {
  const navigate = useNavigate();
  return (href, options = {}) => {
    navigate({ href, replace: options.replace === true }).catch(() => undefined);
  };
}
