import { describe, expect, it } from 'vitest';
import { useDiagramId } from '@site/src/shared/use-cases/useDiagramId';
import { resultOf } from '@site/tests/support/hook';

describe('useDiagramId', () => {
  it('is usable in an id: no colons', () => {
    expect(resultOf(useDiagramId)).toMatch(/^[\w-]+$/u);
  });
});
