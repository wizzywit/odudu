import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandmarkProvider, useLandmark } from '@site/src/shared/lib/use-cases/useLandmark';
import { resultOf } from '@site/tests/support/hook';

function Probe() {
  return <>{useLandmark()}</>;
}

describe('useLandmark', () => {
  it('asks for no landmark unless a page provides the main one', () => {
    expect(resultOf(useLandmark)).toBe('none');
  });

  it('is the landmark a page provided', () => {
    expect(
      renderToStaticMarkup(
        <LandmarkProvider value="main">
          <Probe />
        </LandmarkProvider>,
      ),
    ).toBe('main');
  });
});
