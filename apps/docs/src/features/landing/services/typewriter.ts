// A small deterministic random source, so a test can fix the typing rhythm.
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// The clock the rhythm runs on, so a test can drive it and nothing here reads a global.
export interface Timers<Handle> {
  set: (run: () => void, ms: number) => Handle;
  clear: (handle: Handle | undefined) => void;
}

export interface Rhythm<Handle> {
  // Mean time per keystroke; about 22 characters a second.
  keyMs: number;
  // Each keystroke lasts keyMs times a factor in 1 +- jitter.
  jitter: number;
  // The pause after the command and the beat before each next line.
  afterCommandMs: number;
  lineBeatMs: number;
  random: () => number;
  timers: Timers<Handle>;
}

export const DEFAULT_RHYTHM: Omit<Rhythm<never>, 'random' | 'timers'> = {
  keyMs: 45,
  jitter: 0.45,
  afterCommandMs: 400,
  lineBeatMs: 250,
};

// Types `length` characters, then shows `lines` more lines one by one. Returns
// the function that stops it. Loaded once the page is idle.
export function playTerminal<Handle>(
  length: number,
  lines: number,
  rhythm: Rhythm<Handle>,
  on: {
    count: (typed: number) => void;
    commandDone: () => void;
    line: (shown: number) => void;
    done: () => void;
  },
): () => void {
  let timer: Handle | undefined;
  const later = (ms: number, next: () => void): void => {
    timer = rhythm.timers.set(next, ms);
  };
  const showLine = (shown: number): void => {
    on.line(shown);
    if (shown >= lines) on.done();
    else
      later(rhythm.lineBeatMs, () => {
        showLine(shown + 1);
      });
  };
  const key = (typed: number): void => {
    on.count(typed);
    if (typed >= length) {
      on.commandDone();
      later(rhythm.afterCommandMs, () => {
        showLine(1);
      });
      return;
    }
    later(rhythm.keyMs * (1 + rhythm.jitter * (rhythm.random() * 2 - 1)), () => {
      key(typed + 1);
    });
  };
  later(rhythm.keyMs, () => {
    key(1);
  });
  return () => {
    rhythm.timers.clear(timer);
  };
}
