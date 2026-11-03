import { describe, expect, it } from 'vitest';
import { DOCS_DIRECTORY } from '@site/site.config';
import { useDocsAddress } from '@site/src/shared/lib/use-cases/useDocsAddress';
import { resultOf } from '@site/tests/support/hook';

describe('useDocsAddress', () => {
  it('gives the address of a documentation route under the build', () => {
    expect(resultOf(() => useDocsAddress('/guides/'))).toBe(`/${DOCS_DIRECTORY}guides/`);
  });
});
