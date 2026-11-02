export const height = (): number => window.innerHeight;
export const hidden = (): boolean => document.hidden;
export const agent = (): string => navigator.userAgent;
export const later = (run: () => void): unknown => setTimeout(run, 10);
export const every = (run: () => void): unknown => setInterval(run, 10);
export const idle = (run: () => void): number => requestIdleCallback(run);
export const watch = (): unknown => new IntersectionObserver(() => undefined);
export const env = { document, window };
