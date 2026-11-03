// The media query a reader's wish for less motion answers.
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', onChange);
  return () => {
    media.removeEventListener('change', onChange);
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function serverReducedMotion(): boolean {
  return false;
}
