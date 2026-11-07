import { describe, expect, it } from 'vitest';
import { createGroupRequestSchema } from '#/admin/groups';

describe('createGroupRequestSchema', () => {
  it('takes a name with no slash, since a group’s path is its names joined by slashes', () => {
    expect(createGroupRequestSchema.safeParse({ name: 'staff' }).success).toBe(true);
    expect(createGroupRequestSchema.safeParse({ name: 'a b, c' }).success).toBe(true);
  });

  it.each(['a/b', '/', 'a/', '/a'])('refuses the name %j, which the table cannot hold', (name) => {
    const result = createGroupRequestSchema.safeParse({ name });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('slash');
  });
});
