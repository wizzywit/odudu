import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changed,
  committed,
  DISCRETE,
  EMPTY_HISTORY,
  HISTORY_MAX_BURST,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_JOIN,
  HISTORY_PAUSE_MS,
  inputIntent,
  patchBetween,
  reconciled,
  snapshotOf,
  travelled,
  type History,
  type HistoryEdit,
  type Snapshot,
} from '#/shared/service/code';

const at = (value: string, caret = value.length): Snapshot => ({
  value,
  selectionStart: caret,
  selectionEnd: caret,
});
const typed = (data: string): HistoryEdit => ({ kind: 'insert', data });
const erased: HistoryEdit = { kind: 'delete', data: '' };

interface Run {
  history: History;
  text: Snapshot;
}

// Makes one edit to `run`'s text: `from`..`to` replaced by `put`, caret after it.
function edit(run: Run, put: string, how: HistoryEdit, now: number, range?: [number, number]): Run {
  const [from, to] = range ?? [run.text.selectionStart, run.text.selectionEnd];
  const before = { value: run.text.value, selectionStart: from, selectionEnd: to };
  const value = run.text.value.slice(0, from) + put + run.text.value.slice(to);
  const after = at(value, from + put.length);
  return {
    history: committed(run.history, run.text.value, before, after, how, now),
    text: after,
  };
}

const START: Run = { history: EMPTY_HISTORY, text: at('') };

function typing(text: string, gap = 10, from: Run = START): Run {
  let run = from;
  Array.from(text).forEach((character, index) => {
    run = edit(run, character, typed(character), index * gap);
  });
  return run;
}

// Undoes every step, then redoes every step, returning the text after each.
function walk(run: Run): { back: string[]; forth: string[] } {
  const back: string[] = [];
  let history = run.history;
  let current = run.text.value;
  for (;;) {
    const step = travelled(history, current, current, 'undo');
    if (step.to === null) break;
    history = step.history;
    current = step.to.value;
    back.push(current);
  }
  const forth: string[] = [];
  for (;;) {
    const step = travelled(history, current, current, 'redo');
    if (step.to === null) break;
    history = step.history;
    current = step.to.value;
    forth.push(current);
  }
  return { back, forth };
}

describe('the patch between two texts', () => {
  it('is what was replaced, found from both ends', () => {
    expect(patchBetween(at('hello world', 6), at('hello brave world', 12))).toMatchObject({
      from: 6,
      removed: '',
      inserted: 'brave ',
      before: { start: 6, end: 6 },
      after: { start: 12, end: 12 },
    });
    expect(patchBetween(at('abcd'), at('abXd'))).toMatchObject({
      from: 2,
      removed: 'c',
      inserted: 'X',
    });
  });

  it('is nothing for the same text, and the whole text from nothing', () => {
    expect(patchBetween(at('same'), at('same', 1))).toBeNull();
    expect(patchBetween(at(''), at('x'))).toMatchObject({ from: 0, removed: '', inserted: 'x' });
    expect(patchBetween(at('x'), at(''))).toMatchObject({ from: 0, removed: 'x', inserted: '' });
  });

  it('is the size of the change, not of the text', () => {
    const big = 'x'.repeat(100_000);
    const patch = patchBetween(at(big), at(`${big}y`));
    expect(patch?.inserted).toBe('y');
    expect(patch?.removed).toBe('');
  });
});

describe('coalescing', () => {
  it('keeps a burst of typing as one step', () => {
    expect(typing('abc').history.past).toHaveLength(1);
  });

  it('starts a new step after whitespace, so steps are words', () => {
    expect(walk(typing('ab cd')).back).toEqual(['ab ', '']);
  });

  it('starts a new step after a newline', () => {
    expect(walk(typing('a\nb')).back).toEqual(['a\n', '']);
  });

  it('starts a new step after a pause', () => {
    const run = edit(typing('ab'), 'c', typed('c'), HISTORY_PAUSE_MS + 100);
    expect(walk(run).back).toEqual(['ab', '']);
  });

  it('keeps typing and deleting apart', () => {
    const run = edit(typing('ab'), '', erased, 30, [1, 2]);
    expect(run.text.value).toBe('a');
    expect(walk(run).back).toEqual(['ab', '']);
  });

  it('starts a new step when the caret moved away, and when typing over a selection', () => {
    const moved = edit(typing('abc'), 'X', typed('X'), 30, [0, 0]);
    expect(walk(moved).back).toEqual(['abc', '']);
    const selected = typing('abc');
    const over = edit(
      { ...selected, text: { value: 'abc', selectionStart: 0, selectionEnd: 3 } },
      'z',
      typed('z'),
      30,
    );
    expect(walk(over).back).toEqual(['abc', '']);
  });

  it('gives a Tab, a paste or a cut a step of its own, and the next typing another', () => {
    let run = typing('ab');
    run = edit(run, '  ', DISCRETE, 30);
    run = edit(run, 'c', typed('c'), 40);
    expect(walk(run).back).toEqual(['ab  ', 'ab', '']);
  });

  it('does not join one discrete edit to another', () => {
    let run = edit(START, 'a', DISCRETE, 0);
    run = edit(run, 'b', DISCRETE, 5);
    expect(run.history.past).toHaveLength(2);
  });

  it('cuts a very long burst into steps', () => {
    const run = typing('x'.repeat(HISTORY_MAX_BURST + 10), 1);
    expect(run.history.past).toHaveLength(2);
  });

  it('does not join an edit larger than a keystroke to a burst', () => {
    const big = 'x'.repeat(HISTORY_MAX_JOIN + 1);
    const run = edit(typing('ab'), big, typed(big), 30);
    expect(run.history.past).toHaveLength(2);
  });

  it('does not note an edit that changed nothing, and keeps the redo line', () => {
    const back = travelled(typing('ab').history, 'ab', 'ab', 'undo');
    const same = committed(back.history, '', at(''), at('', 0), typed(''), 5);
    expect(same).toBe(back.history);
  });
});

describe('undo and redo', () => {
  it('go back to the text and the caret before the edit, and forward again', () => {
    const run = edit(edit(START, 'ab', DISCRETE, 0), 'XY', DISCRETE, 5, [1, 1]);
    expect(run.text.value).toBe('aXYb');
    const back = travelled(run.history, 'aXYb', 'aXYb', 'undo');
    expect(back.to).toEqual(at('ab', 1));
    const forth = travelled(back.history, 'ab', 'ab', 'redo');
    expect(forth.to).toEqual(at('aXYb', 3));
  });

  it('are nothing past the start or past the end, and change nothing', () => {
    expect(travelled(EMPTY_HISTORY, 'x', 'x', 'undo')).toEqual({
      history: EMPTY_HISTORY,
      to: null,
    });
    expect(travelled(EMPTY_HISTORY, 'x', 'x', 'redo')).toEqual({
      history: EMPTY_HISTORY,
      to: null,
    });
    const run = typing('a');
    const back = travelled(run.history, 'a', 'a', 'undo');
    expect(travelled(back.history, '', '', 'undo').to).toBeNull();
  });

  it('end the redo line with a new edit', () => {
    const back = travelled(typing('abc').history, 'abc', 'abc', 'undo');
    expect(back.history.future).toHaveLength(1);
    const run = edit({ history: back.history, text: at('') }, 'z', typed('z'), 5000);
    expect(run.history.future).toEqual([]);
  });

  it('end a burst, so typing after an undo is a step of its own', () => {
    const back = travelled(typing('ab').history, 'ab', 'ab', 'undo');
    const run = edit({ history: back.history, text: at('') }, 'z', typed('z'), 20);
    expect(run.history.past).toHaveLength(1);
  });

  it('put back the text through every step of a mixed run, and again forward', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    let run = START;
    const texts = [''];
    for (let step = 0; step < 150; step += 1) {
      const length = run.text.value.length;
      const from = Math.floor(random() * (length + 1));
      const to = Math.min(length, from + Math.floor(random() * 4));
      const put = random() < 0.3 ? '' : 'ab c\n'.slice(0, 1 + Math.floor(random() * 4));
      const kind = random() < 0.5 ? DISCRETE : typed(put);
      run = edit(run, put, kind, step * 2000, [from, to]);
      if (run.text.value !== texts[texts.length - 1]) texts.push(run.text.value);
    }
    const { back, forth } = walk(run);
    expect(back.length).toBeGreaterThan(30);
    expect(back[back.length - 1]).toBe('');
    expect(forth[forth.length - 1]).toBe(run.text.value);
    expect(back.length).toBe(forth.length);
  });

  it('end the history instead of putting a step where it does not fit', () => {
    const run = typing('abc');
    const entry = run.history.past[0];
    const patch = entry?.patches[0];
    expect(patch).toBeDefined();
    const broken = travelled(
      {
        ...run.history,
        past:
          entry === undefined || patch === undefined
            ? []
            : [{ ...entry, patches: [{ ...patch, from: 50 }] }],
      },
      'abc',
      'abc',
      'undo',
    );
    expect(broken).toEqual({ history: EMPTY_HISTORY, to: null });
  });

  it('put back an astral character, and a pair that an edit split', () => {
    const smile = '\u{1F600}';
    let run = edit(START, `a${smile}b`, DISCRETE, 0);
    run = edit(run, '\u{1F601}', DISCRETE, 5, [1, 3]);
    expect(run.text.value).toBe('a\u{1F601}b');
    expect(run.history.past[1]?.patches[0]).toMatchObject({
      removed: '\uDE00',
      inserted: '\uDE01',
    });
    const { back, forth } = walk(run);
    expect(back).toEqual([`a${smile}b`, '']);
    expect(forth).toEqual([`a${smile}b`, 'a\u{1F601}b']);
    const typedSmile = edit(typing('x'), smile, typed(smile), 30);
    expect(walk(typedSmile).back).toEqual(['']);
    expect(typedSmile.text.value).toBe(`x${smile}`);
  });
});

describe('the caps', () => {
  it('keep at most the steps it names, the newest', () => {
    let run = START;
    for (let index = 0; index < HISTORY_MAX_ENTRIES + 50; index += 1) {
      run = edit(run, 'x', DISCRETE, index);
    }
    expect(run.history.past).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(walk(run).back).toHaveLength(HISTORY_MAX_ENTRIES);
  });

  it('keep the steps within the characters it names, but never none', () => {
    const half = 'x'.repeat(HISTORY_MAX_CHARS / 2 + 1);
    let run = edit(START, half, DISCRETE, 0);
    run = edit(run, half, DISCRETE, 1);
    expect(run.history.past).toHaveLength(1);
    const huge = edit(START, 'x'.repeat(HISTORY_MAX_CHARS * 2), DISCRETE, 0);
    expect(huge.history.past).toHaveLength(1);
  });

  it('count what a step changed, so a large text keeps its depth under typing', () => {
    const big = 'x'.repeat(131_072);
    let run: Run = { history: EMPTY_HISTORY, text: at(big, big.length) };
    for (let index = 0; index < 100; index += 1) {
      run = edit(run, 'a', DISCRETE, index);
    }
    expect(run.history.past).toHaveLength(100);
  });

  it('bound the redo line too', () => {
    let run = START;
    for (let index = 0; index < HISTORY_MAX_ENTRIES + 10; index += 1) {
      run = edit(run, 'x', DISCRETE, index);
    }
    let history = run.history;
    let current = run.text.value;
    for (let step = 0; step < HISTORY_MAX_ENTRIES + 10; step += 1) {
      const back = travelled(history, current, current, 'undo');
      if (back.to === null) break;
      history = back.history;
      current = back.to.value;
    }
    expect(history.future.length).toBeLessThanOrEqual(HISTORY_MAX_ENTRIES);
  });
});

describe('on a 128 KiB text', () => {
  const big = 'a { color: red }\n'.repeat(8192);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('typing 200 characters stores 200 one-character patches in one step', () => {
    let run: Run = { history: EMPTY_HISTORY, text: at(big, 6) };
    for (let index = 0; index < 200; index += 1) {
      run = edit(run, 'x', typed('x'), index * 5, [6 + index, 6 + index]);
    }
    expect(run.history.past).toHaveLength(1);
    const [entry] = run.history.past;
    expect(entry?.patches).toHaveLength(200);
    expect(entry?.patches.every((patch) => patch.removed.length + patch.inserted.length <= 1)).toBe(
      true,
    );
    expect(entry?.weight).toBe(200);
    const back = travelled(run.history, run.text.value, run.text.value, 'undo');
    expect(back.to?.value).toBe(big);
    expect(back.to?.selectionStart).toBe(6);
  });

  it('finds the change at the caret without reading the text, and reads it once when the guess is wrong', () => {
    const middle = big.length / 2;
    const reads = vi.spyOn(String.prototype, 'charCodeAt');
    const near = patchBetween(
      at(big, middle),
      at(`${big.slice(0, middle)}x${big.slice(middle)}`, middle + 1),
    );
    expect(near).toMatchObject({ from: middle, inserted: 'x' });
    expect(reads.mock.calls.length).toBeLessThan(20);
    reads.mockClear();
    const wrong = patchBetween(
      { value: big, selectionStart: big.length, selectionEnd: big.length },
      at(`x${big}`, 1),
    );
    expect(wrong).toMatchObject({ from: 0, inserted: 'x' });
    expect(reads.mock.calls.length).toBeLessThanOrEqual(2 * big.length + 10);
  });

  it('agrees with reading from both ends, whatever the selection says', () => {
    let seed = 11;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const naive = (was: string, now: string): [number, string, string] | null => {
      let from = 0;
      while (from < Math.min(was.length, now.length) && was[from] === now[from]) from += 1;
      let a = was.length;
      let b = now.length;
      while (a > from && b > from && was[a - 1] === now[b - 1]) {
        a -= 1;
        b -= 1;
      }
      return a === from && b === from ? null : [from, was.slice(from, a), now.slice(from, b)];
    };
    for (let round = 0; round < 400; round += 1) {
      const was = Array.from(
        { length: Math.floor(random() * 12) },
        () => 'ab\n'[Math.floor(random() * 3)],
      ).join('');
      const from = Math.floor(random() * (was.length + 1));
      const to = Math.min(was.length, from + Math.floor(random() * 4));
      const put = 'abx'.slice(0, Math.floor(random() * 4));
      const now = was.slice(0, from) + put + was.slice(to);
      const guess = Math.floor(random() * (was.length + 2));
      const patch = patchBetween(
        { value: was, selectionStart: guess, selectionEnd: Math.min(was.length, guess + 1) },
        at(now, Math.floor(random() * (now.length + 1))),
      );
      const expected = naive(was, now);
      expect(patch === null ? null : [patch.from, patch.removed, patch.inserted]).toEqual(expected);
    }
  });
});

describe('a text changed from outside', () => {
  it('has no history', () => {
    const history = typing('abc').history;
    expect(reconciled(history, 'abc', 'abc')).toBe(history);
    expect(reconciled(history, 'abc', 'other')).toBe(EMPTY_HISTORY);
  });

  it('is not travelled into, and the next edit starts a fresh history', () => {
    const history = typing('abc').history;
    expect(travelled(history, 'abc', 'replaced', 'undo')).toEqual({
      history: EMPTY_HISTORY,
      to: null,
    });
    const next = committed(history, 'abc', at('other'), at('other!'), DISCRETE, 5000);
    expect(next.past).toHaveLength(1);
  });
});

describe('what a beforeinput means', () => {
  it('maps history, typing, deleting, paste and composition', () => {
    expect(inputIntent('historyUndo', null)).toBe('undo');
    expect(inputIntent('historyRedo', null)).toBe('redo');
    expect(inputIntent('insertText', 'a')).toEqual({ kind: 'insert', data: 'a' });
    expect(inputIntent('insertLineBreak', null)).toEqual({ kind: 'insert', data: '\n' });
    expect(inputIntent('deleteContentBackward', null)).toEqual({ kind: 'delete', data: '' });
    expect(inputIntent('deleteWordBackward', null)).toEqual({ kind: 'delete', data: '' });
    expect(inputIntent('insertFromPaste', 'x')).toEqual(DISCRETE);
    expect(inputIntent('deleteByCut', null)).toEqual(DISCRETE);
    expect(inputIntent('insertFromDrop', null)).toEqual(DISCRETE);
    expect(inputIntent('insertCompositionText', 'あ')).toBe('ignore');
    expect(inputIntent('deleteCompositionText', null)).toBe('ignore');
    expect(inputIntent('insertText', 'a', true)).toBe('ignore');
    expect(inputIntent('historyUndo', null, true)).toBe('ignore');
  });
});

it('reads a snapshot from a field', () => {
  expect(snapshotOf({ value: 'ab', selectionStart: 1, selectionEnd: 2 })).toEqual({
    value: 'ab',
    selectionStart: 1,
    selectionEnd: 2,
  });
});

describe('what a change does to the history', () => {
  const run = typing('abc');

  it('notes an edit that was heard coming', () => {
    const next = changed(
      run.history,
      'abc',
      { before: at('abc'), edit: DISCRETE },
      at('abcd'),
      false,
      5000,
    );
    expect(next.past).toHaveLength(2);
  });

  it('ends the history for a change nobody heard coming, unless an input method is composing', () => {
    expect(changed(run.history, 'abc', null, at('abcd'), false, 5000)).toBe(EMPTY_HISTORY);
    expect(changed(run.history, 'abc', null, at('abcd'), true, 5000)).toBe(run.history);
  });
});
