import { expect, it } from 'vitest';
import { CONSOLE_TITLE, PRODUCT_NAME } from '#/shared/lib/services/product';

// The wordmark is lowercase, as the brand draws it; the console's own title
// is the name in a sentence. Each is one constant.
it('spells the product two ways, each once', () => {
  expect(PRODUCT_NAME).toBe('odudu');
  expect(CONSOLE_TITLE).toBe('Odudu console');
});
