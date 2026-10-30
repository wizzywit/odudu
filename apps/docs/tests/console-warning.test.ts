import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const squeezed = (text: string): string => text.replace(/\s+/gu, ' ');

it("quotes the sign-out confirmation warning exactly as the console's Logout tab shows it", () => {
  const source = readFileSync(
    path.resolve(DOCS_ROOT, '../admin-console/src/features/clients/service/logout.ts'),
    'utf8',
  );
  const warning = /SKIP_LOGOUT_WARNING =\s*'([^']+)'/u.exec(source)?.[1];
  expect(warning).toMatch(/^When this is on/u);
  const page = readFileSync(path.join(DOCS_ROOT, 'content/en/admin-console/clients.mdx'), 'utf8');
  expect(squeezed(page)).toContain(squeezed(warning ?? ''));
});
