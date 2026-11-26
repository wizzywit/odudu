import { KeyHint } from '#/shared/ui/KeyHint';
import styles from '#/entities/assistant/ui/AssistantButton/AssistantButton.module.css';

// The control that opens the panel, drawn on the shell's dark rail and top
// bar. The shortcut is on the button for assistive technology and beside it
// for everyone else; the label is always there, the mark never alone.
export function AssistantButton({
  label,
  hintLead,
  shortcut,
  expanded,
  panelId,
  onPress,
}: {
  label: string;
  hintLead: string;
  // The chord as aria-keyshortcuts names it.
  shortcut: string;
  expanded: boolean;
  panelId: string;
  onPress: (opener: HTMLElement) => void;
}) {
  return (
    <span className={styles.control}>
      {/* A native button, because React Aria's drops aria-keyshortcuts. */}
      <button
        type="button"
        className={styles.button}
        aria-keyshortcuts={shortcut}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={(event) => {
          onPress(event.currentTarget);
        }}
      >
        <svg className={styles.mark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4z" />
        </svg>
        {label}
      </button>
      <span className={styles.hint}>
        <KeyHint lead={hintLead} keys={['Mod', 'K']} announced />
      </span>
    </span>
  );
}
