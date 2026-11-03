import { describe, expect, it } from 'vitest';
import {
  NOT_FOUND_MESSAGE,
  NOT_FOUND_ROUTES,
  NOT_FOUND_TITLE,
  SEARCH_LABEL,
} from '@site/src/features/not-found/services/notFound';
import { useNotFound } from '@site/src/features/not-found/use-cases/useNotFound';
import { resultOf } from '@site/tests/support/hook';

describe('useNotFound', () => {
  it('hands the page its words and the routes to offer', () => {
    expect(resultOf(useNotFound)).toEqual({
      title: NOT_FOUND_TITLE,
      message: NOT_FOUND_MESSAGE,
      routes: NOT_FOUND_ROUTES,
      searchLabel: SEARCH_LABEL,
    });
  });
});
