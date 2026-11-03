import { describe, expect, it } from 'vitest';
import { COMMANDS, FOLLOW_UP } from '@site/src/features/landing/services/installCommands';
import { noteFor } from '@site/src/features/landing/services/copyStatus';
import { installView, type InstallState } from '@site/src/features/landing/services/installView';
import { TYPED_COMMAND } from '@site/src/features/landing/services/installTyping';

const START: InstallState = {
  shell: 'unix',
  status: 'idle',
  typing: 'off',
  typed: 0,
  lines: 0,
  interactive: false,
};

const LINES = [FOLLOW_UP.command, ...FOLLOW_UP.output];

describe('the hero terminal as the view draws it', () => {
  it('offers each shell with its label, and the chosen one checked', () => {
    expect(installView(START).shells).toEqual(
      COMMANDS.map(({ shell, label }) => ({ shell, label, checked: shell === 'unix' })),
    );
    expect(installView({ ...START, shell: 'windows' }).shells.map((s) => s.checked)).toEqual([
      false,
      true,
    ]);
  });

  it("gives each panel its shell's whole command, in pieces that lose nothing", () => {
    const { panels } = installView(START);
    expect(panels.map((panel) => panel.command.map((piece) => piece.text).join(''))).toEqual(
      COMMANDS.map((entry) => entry.command),
    );
    expect(panels[0]?.command.map((piece) => piece.breakBefore)[0]).toBe(false);
  });

  it('types only on the first shell, and shows its overlay only while it types', () => {
    const typing = installView({ ...START, typing: 'on', typed: 5 }).panels;
    expect(typing.map((panel) => panel.typing)).toEqual(['on', 'off']);
    expect(typing[0]?.overlay?.map((part) => part.shown).join('')).toBe(TYPED_COMMAND.slice(0, 5));
    expect(typing[1]?.overlay).toBeNull();
    expect(installView({ ...START, typing: 'after' }).panels[0]?.overlay).toBeNull();
    expect(installView({ ...START, shell: 'windows', typing: 'on' }).panels[0]?.overlay).toBeNull();
  });

  it('shows follow-up lines as typed on the first shell and always on the others', () => {
    const typing = installView({ ...START, typing: 'after', lines: 1 }).panels;
    expect(typing[0]?.lines.map((line) => line.text)).toEqual(LINES);
    expect(typing[0]?.lines.map((line) => line.visible)).toEqual([true, false, false]);
    expect(typing[0]?.lines.map((line) => line.kind)).toEqual(['command', 'output', 'output']);
    expect(typing[1]?.lines.every((line) => line.visible)).toBe(true);
  });

  it('says what copying did, and keeps the button out until script has run', () => {
    expect(installView(START).copyBar).toEqual({
      label: 'Copy',
      note: noteFor('idle'),
      hidden: true,
    });
    expect(installView({ ...START, status: 'copied', interactive: true }).copyBar).toEqual({
      label: 'Copied',
      note: noteFor('copied'),
      hidden: false,
    });
  });
});
