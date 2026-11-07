import { describe, expect, it } from 'vitest';
import stableText from '#docs/plugins/stable-text.ts';

describe('the build leaves the text of a page as written', () => {
  it('does not let the bundler rewrite an eight-character hex string that equals a chunk hash', () => {
    const plugin = stableText();
    const config = plugin.configureWebpack?.({}, false, {} as never, undefined);
    expect(config).toMatchObject({ optimization: { realContentHash: false } });
  });
});
