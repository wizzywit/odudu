import mono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2';
import sans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2';
import sans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2';

// The three Plex files the first screen draws with, fetched before the stylesheet names them.
export const FONT_PRELOADS: string[] = [sans400, sans600, mono400];
