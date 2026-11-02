import { describe, expect, it } from 'vitest';
import { Frame } from '@site/src/features/landing/ui/Frame/Frame';
import { markupOf } from '@site/tests/support/markup';

describe('Frame', () => {
  it.each(['large', 'small', 'look'] as const)(
    'names its %s kind for the pages that measure it',
    (kind) => {
      const $ = markupOf(
        <Frame kind={kind}>
          <img src="a.webp" alt="" width="460" height="508" />
        </Frame>,
      );
      expect($(`[data-frame="${kind}"] img`)).toHaveLength(1);
    },
  );
});
