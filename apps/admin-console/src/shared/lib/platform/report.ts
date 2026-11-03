// A mistake of the console's own, for whoever reads the browser's console.
export function reportDefect(message: string): void {
  console.error(message);
}
