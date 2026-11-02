export const height = (): number => window.innerHeight;
export const hidden = (): boolean => document.hidden;
export const agent = (): string => navigator.userAgent;
export const later = (run: () => void): unknown => setTimeout(run, 10);
export const watch = (): unknown => new IntersectionObserver(() => undefined);
export const frame = (run: () => void): number => requestAnimationFrame(run);
export const pass = { window };
