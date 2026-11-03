import {
  COMMANDS,
  FOLLOW_UP,
  type Shell,
} from '@site/src/features/landing/services/installCommands';

// How far the hero's terminal has got: not started, typing the command, past
// it, finished, or skipped for a reader who asked for less motion.
export type Typing = 'off' | 'on' | 'after' | 'done' | 'skip';

export const TYPING_SEED = 7;

export function commandOf(shell: Shell): string {
  return COMMANDS.find((entry) => entry.shell === shell)?.command ?? '';
}

// The command the terminal types: the first shell's, from the one table.
export const TYPED_COMMAND = commandOf('unix');

// The command's pieces, broken after each slash so a long address wraps there.
export function segments(text: string): string[] {
  return text.split(/(?<=\/)/u);
}

export interface Piece {
  text: string;
  // A slash-break opportunity goes before every piece but the first.
  breakBefore: boolean;
}

export function pieces(text: string): Piece[] {
  return segments(text).map((part, index) => ({ text: part, breakBefore: index > 0 }));
}

export interface TypedSegment {
  shown: string;
  hidden: string;
  hasHidden: boolean;
  breakBefore: boolean;
}

// The same pieces with only the first `count` characters shown, so the line
// breaks are final from the first character.
export function typedSegments(text: string, count: number): TypedSegment[] {
  let left = count;
  return segments(text).map((part, index) => {
    const shown = part.slice(0, Math.max(left, 0));
    left -= part.length;
    const hidden = part.slice(shown.length);
    return { shown, hidden, hasHidden: hidden.length > 0, breakBefore: index > 0 };
  });
}

export interface FollowUpLine {
  text: string;
  kind: 'command' | 'output';
}

// The quick start's next step: its command, then what it prints.
export function followUpLines(): FollowUpLine[] {
  return [
    { text: FOLLOW_UP.command, kind: 'command' },
    ...FOLLOW_UP.output.map((text) => ({ text, kind: 'output' as const })),
  ];
}

// The typing state a shell's panel carries: only the first shell types.
export function panelTyping(shell: Shell, typing: Typing): Typing {
  return shell === 'unix' ? typing : 'off';
}

// A follow-up line shows once it is typed, and always off the typing shell or when typing is skipped.
export function lineVisible(shell: Shell, typing: Typing, lines: number, index: number): boolean {
  return shell !== 'unix' || typing === 'skip' || typing === 'done' || index < lines;
}

// Which shell shows the typing overlay: only the first, and only while it types.
export function overlayShown(shell: Shell, chosen: Shell, typing: Typing): boolean {
  return shell === 'unix' && chosen === 'unix' && typing === 'on';
}

// Under reduced motion the terminal is simply shown, whatever had started.
export function effectiveTyping(reduced: boolean, started: Typing): Typing {
  return reduced ? 'skip' : started;
}

// Choosing another shell mid-typing lets the command stand as it is.
export function typingAfterChoice(typing: Typing): Typing {
  return typing === 'on' ? 'after' : typing;
}

export interface ShellChoice {
  shell: Shell;
  label: string;
  command: string;
  checked: boolean;
}

// Every shell with its command, and which one the reader has chosen.
export function shellChoices(chosen: Shell): ShellChoice[] {
  return COMMANDS.map((entry) => ({ ...entry, checked: entry.shell === chosen }));
}
