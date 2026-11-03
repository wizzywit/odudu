import type { Shell } from '@site/src/features/landing/services/installCommands';
import {
  copyLabel,
  noteFor,
  type CopyStatus,
} from '@site/src/features/landing/services/copyStatus';
import {
  TYPED_COMMAND,
  followUpLines,
  lineVisible,
  overlayShown,
  panelTyping,
  pieces,
  shellChoices,
  typedSegments,
  type FollowUpLine,
  type Piece,
  type TypedSegment,
  type Typing,
} from '@site/src/features/landing/services/installTyping';

export interface InstallState {
  shell: Shell;
  status: CopyStatus;
  typing: Typing;
  typed: number;
  lines: number;
  interactive: boolean;
}

export interface InstallShell {
  shell: Shell;
  label: string;
  checked: boolean;
}

export interface InstallLine {
  text: string;
  kind: FollowUpLine['kind'];
  visible: boolean;
}

export interface InstallPanel {
  shell: Shell;
  command: Piece[];
  typing: Typing;
  overlay: TypedSegment[] | null;
  lines: InstallLine[];
}

export interface CopyBar {
  label: 'Copied' | 'Copy';
  note: string;
  hidden: boolean;
}

export interface InstallView {
  shells: InstallShell[];
  panels: InstallPanel[];
  copyBar: CopyBar;
}

// Everything the hero's terminal draws, from the hook's state.
export function installView(state: InstallState): InstallView {
  const choices = shellChoices(state.shell);
  return {
    shells: choices.map(({ shell, label, checked }) => ({ shell, label, checked })),
    panels: choices.map((entry) => ({
      shell: entry.shell,
      command: pieces(entry.command),
      typing: panelTyping(entry.shell, state.typing),
      overlay: overlayShown(entry.shell, state.shell, state.typing)
        ? typedSegments(TYPED_COMMAND, state.typed)
        : null,
      lines: followUpLines().map((line, index) => ({
        text: line.text,
        kind: line.kind,
        visible: lineVisible(entry.shell, state.typing, state.lines, index),
      })),
    })),
    copyBar: {
      label: copyLabel(state.status),
      note: noteFor(state.status),
      hidden: !state.interactive,
    },
  };
}
