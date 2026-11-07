import type { Plugin } from '@docusaurus/types';

// The bundler's real-content-hash pass rewrites any text in the server bundle that
// equals a chunk's provisional hash, eight hex characters, with the final one. A
// transcript holds such strings (the tail of an id), and one that matched changed
// a page's recorded bytes for one commit and not for another. Chunk names keep the
// content hash they were given, so caching is unaffected.
export default function stableText(): Plugin {
  return {
    name: 'odudu-stable-text',
    configureWebpack() {
      return { optimization: { realContentHash: false } };
    },
  };
}
