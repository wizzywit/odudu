import type { Plugin } from '@docusaurus/types';

// Every page adds a module and a chunk to what the first visit downloads: their
// numbers sit in the page registry and in the chunk map, and the default ids are
// scattered five-digit numbers that compress poorly. Sequential ones are shorter
// and repeat their digits, which is worth about 2 KB gzip across the site.
export default function compactIds(): Plugin {
  return {
    name: 'odudu-compact-ids',
    configureWebpack() {
      return { optimization: { chunkIds: 'natural', moduleIds: 'natural' } };
    },
  };
}
