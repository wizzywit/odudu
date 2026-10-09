interface Settings {
  readonly localStorage: string;
}

// Mentions localStorage in a comment, a string and a property of its own.
export const described = 'sessionStorage';

export function read(settings: Settings): string {
  return settings.localStorage;
}
