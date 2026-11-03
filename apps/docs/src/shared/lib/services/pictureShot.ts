export interface ShotSize {
  width: number;
  height: number;
}

export type ShotScheme = 'light' | 'dark';

// Where a set of pictures lives: its manifest of captured sizes, its folder
// under the site, and what the thrown error calls one of them.
export interface ShotSource {
  manifest: Record<string, ShotSize>;
  directory: string;
  noun: string;
}

export interface ShotCatalogue {
  sizeOf: (name: string) => ShotSize;
  addressOf: (name: string, scheme: ShotScheme) => string;
}

// The two captures of each picture, named `<directory>/<name>-<scheme>.webp`,
// and the size the capture wrote in its manifest.
export function shotCatalogue({ manifest: sizes, directory, noun }: ShotSource): ShotCatalogue {
  return {
    sizeOf: (name) => {
      const size = sizes[name];
      if (size === undefined) throw new Error(`no ${noun} named ${name}`);
      return { width: size.width, height: size.height };
    },
    addressOf: (name, scheme) => `${directory}/${name}-${scheme}.webp`,
  };
}
