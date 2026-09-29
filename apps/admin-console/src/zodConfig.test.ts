import '#/zodConfig.ts';
import { z } from 'zod';
import { expect, it } from 'vitest';

it('switches zod to jitless, so building a schema never probes `new Function`', () => {
  expect(z.config().jitless).toBe(true);
});
