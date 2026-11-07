import { describe, expect, it } from 'vitest';
import { COMMANDS, FOLLOW_UP } from '@site/src/features/landing/services/installCommands';
import { RELEASE_CAVEAT } from '@site/src/features/landing/services/release';
import { Install } from '@site/src/features/landing/ui/Install/Install';
import { markupOf } from '@site/tests/support/markup';

describe('Install', () => {
  it("prints each shell's whole command as real text", () => {
    const $ = markupOf(<Install />);
    for (const entry of COMMANDS) {
      expect($(`code[data-shell="${entry.shell}"]`).text()).toBe(entry.command);
    }
  });

  it('offers the shells as radios, the first checked, with a label each', () => {
    const $ = markupOf(<Install />);
    expect($('input[type="radio"]')).toHaveLength(2);
    expect($('input[checked]').attr('data-shell')).toBe('unix');
    expect($('label')).toHaveLength(2);
  });

  it('keeps the copy button out until script has run, and carries no release-candidate caveat', () => {
    const $ = markupOf(<Install />);
    expect($('button[hidden]')).toHaveLength(1);
    expect($('[data-install-note]').text()).not.toContain(RELEASE_CAVEAT);
  });

  it("holds the quick start's next step in each panel, waiting for the typing on the first", () => {
    const $ = markupOf(<Install />);
    const lines = [FOLLOW_UP.command, ...FOLLOW_UP.output];
    expect(
      $('[data-panel="unix"] [data-visible]')
        .map((_, line) => $(line).text())
        .get(),
    ).toEqual(lines);
    expect($('[data-panel="unix"] [data-visible="false"]')).toHaveLength(lines.length);
    expect($('[data-panel="windows"] [data-visible="true"]')).toHaveLength(lines.length);
  });
});
