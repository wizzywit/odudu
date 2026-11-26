import { describe, expect, it } from 'vitest';
import { splitBlocks } from '#/widgets/assistant-panel/services/blocks';

describe('splitting a streamed answer at the block still being written', () => {
  it('has no settled block while the first is open', () => {
    expect(splitBlocks('Hello wor')).toEqual({ settled: [], open: 'Hello wor' });
    expect(splitBlocks('')).toEqual({ settled: [], open: '' });
  });

  it('settles every block a blank line has closed', () => {
    expect(splitBlocks('One.\n\nTwo.\n\nThr')).toEqual({
      settled: ['One.', 'Two.'],
      open: 'Thr',
    });
  });

  it('keeps blank lines inside a code fence in one block, open until the fence closes', () => {
    expect(splitBlocks('Intro\n\n```\na\n\nb')).toEqual({
      settled: ['Intro'],
      open: '```\na\n\nb',
    });
    expect(splitBlocks('```\na\n\nb\n```\n\nAfter')).toEqual({
      settled: ['```\na\n\nb\n```'],
      open: 'After',
    });
  });

  it('treats a run of blank lines as one separator', () => {
    expect(splitBlocks('A\n\n\n\nB')).toEqual({ settled: ['A'], open: 'B' });
  });

  it('puts back together as the same text, so no character is lost or added', () => {
    const text = 'A\n\n- x\n- y\n\n```\nc\n\nd\n```\n\ntail';
    const { settled, open } = splitBlocks(text);
    expect([...settled, open].join('\n\n')).toBe(text);
  });

  it('leaves a finished answer’s last block open too, so one rule serves both', () => {
    expect(splitBlocks('A\n\nB')).toEqual({ settled: ['A'], open: 'B' });
  });
});
