import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useEffectiveReading } from '#/pages/email/use-cases/useEffectiveReading';

it('says whose relay sends the mail as a tone, a word and a sentence', () => {
  const { result } = renderHook(() => useEffectiveReading('none'));
  expect(result.current).toEqual({
    tone: 'warning',
    label: 'not sent',
    text: 'Nothing sends this tenant’s mail: verification and reset mail is only written to the server’s log.',
  });
});
