import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Highlight } from '@site/src/features/code-block/ui/Highlight/Highlight';
import { parseLines } from '@site/src/features/code-block/services/lines';
import { WrittenLinesProvider } from '@site/src/features/code-block/use-cases/useWrittenLines';

function show(code: string, written?: string): string {
  return renderToStaticMarkup(
    <WrittenLinesProvider value={parseLines(written)}>
      <Highlight code={code} language="json">
        {({ className, tokens, getLineProps, getTokenProps }) => (
          <pre className={className}>
            {tokens.map((line, index) => (
              <div key={index} {...getLineProps({ line })}>
                {line.map((token, at) => (
                  <span key={at} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </WrittenLinesProvider>,
  );
}

describe('Highlight', () => {
  it('draws the lines the build wrote, with a class per token', () => {
    expect(
      show(
        '[1]',
        JSON.stringify([
          [
            ['punctuation', '['],
            ['number', '1'],
            ['punctuation', ']'],
          ],
        ]),
      ),
    ).toBe(
      '<pre class="prism-code language-json"><div class="token-line"><span class="tok-punctuation">[</span><span class="tok-number">1</span><span class="tok-punctuation">]</span></div></pre>',
    );
  });

  it('draws plain text where nothing was written', () => {
    expect(show('a\nb')).toContain('<div class="token-line"><span>b</span></div>');
  });
});
