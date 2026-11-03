import useIsBrowser from '@docusaurus/useIsBrowser';
import { useEffect, useState } from 'react';
import type { Shell } from '@site/src/features/landing/services/content';
import {
  COPIED_FOR_MS,
  copyStatusOf,
  type CopyStatus,
} from '@site/src/features/landing/services/copyStatus';
import {
  TYPED_COMMAND,
  TYPING_SEED,
  commandOf,
  effectiveTyping,
  followUpLines,
  typingAfterChoice,
  type Typing,
} from '@site/src/features/landing/services/installTyping';
import type { Timers } from '@site/src/features/landing/services/typewriter';
import { usePrefersReducedMotion } from '@site/src/shared/use-cases/usePrefersReducedMotion';
import { copyText } from '@site/src/shared/platform/clipboard';
import { schedule } from '@site/src/shared/platform/timers';
import { useIdle } from '@site/src/shared/use-cases/useIdle';

export interface Install {
  shell: Shell;
  status: CopyStatus;
  typing: Typing;
  typed: number;
  lines: number;
  interactive: boolean;
  choose: (shell: Shell) => void;
  copy: () => void;
}

// The page's own clock, handed to the typewriter service.
const WINDOW_TIMERS: Timers<() => void> = {
  set: schedule,
  clear: (cancel) => {
    cancel?.();
  },
};

// The command is real text from the first paint. Once the page is idle a
// visual copy types over it, then the quick start's next step appears line by
// line; copying always takes the whole command.
export function useInstall(): Install {
  const [shell, setShell] = useState<Shell>('unix');
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [started, setTyping] = useState<Typing>('off');
  const reduced = usePrefersReducedMotion();
  const [typed, setTyped] = useState(0);
  const [lines, setLines] = useState(0);
  const interactive = useIsBrowser();

  useIdle(!reduced, 400, () => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    import('@site/src/features/landing/services/typewriter').then(
      ({ DEFAULT_RHYTHM, playTerminal, seeded }) => {
        if (cancelled) return;
        setTyping('on');
        stop = playTerminal(
          TYPED_COMMAND.length,
          followUpLines().length,
          { ...DEFAULT_RHYTHM, random: seeded(TYPING_SEED), timers: WINDOW_TIMERS },
          {
            count: setTyped,
            commandDone: () => {
              setTyping('after');
            },
            line: setLines,
            done: () => {
              setTyping('done');
            },
          },
        );
      },
      () => {
        setTyping('skip');
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  });

  useEffect(() => {
    if (status === 'idle') return undefined;
    return schedule(() => {
      setStatus('idle');
    }, COPIED_FOR_MS);
  }, [status]);

  return {
    shell,
    status,
    typing: effectiveTyping(reduced, started),
    typed,
    lines,
    interactive,
    choose: (next) => {
      setShell(next);
      setStatus('idle');
      setTyping(typingAfterChoice);
    },
    copy: () => {
      copyText(commandOf(shell)).then(
        (copied) => {
          setStatus(copyStatusOf(copied));
        },
        () => undefined,
      );
    },
  };
}
