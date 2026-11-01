import { useEffect, useRef, type RefObject } from 'react';
import { useLatest } from '#/shared/repository/useLatest';
import {
  changed,
  changesNothing,
  committed,
  DISCRETE,
  EMPTY_HISTORY,
  historyKey,
  inputIntent,
  reconciled,
  snapshotOf,
  travelled,
  type History,
  type KeyPress,
  type Pending,
  type Snapshot,
  type TextEdit,
} from '#/shared/service/code';
import { PLATFORM } from '#/shared/service/platform';

export interface CodeHistory {
  // The field's onChange: it also settles what the change did to the history.
  change: (value: string) => void;
  // Handles Cmd or Ctrl+Z and redo; true when the key was one of them.
  keyed: (press: KeyPress, event: { preventDefault: () => void }) => boolean;
  // Makes an edit as a step of its own.
  replace: (edit: TextEdit) => void;
  composing: () => boolean;
  compositionStart: () => void;
  compositionEnd: () => void;
}

// The undo history of a code field. Each edit, typed or made by the field, is
// heard before it happens and noted as a patch once it has; undo and redo are
// heard as `beforeinput` of type historyUndo and historyRedo and as the keys,
// and put the text back through the same onChange typing uses. The browser's
// own undo is not relied on: setting the text from code empties it.
export function useCodeHistory({
  value,
  onChange,
  readOnly,
  moved,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  // Told after the field set the text or the selection from code, so the
  // view can bring the caret into sight.
  moved: (area: HTMLTextAreaElement) => void;
}): [RefObject<HTMLTextAreaElement | null>, CodeHistory] {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const history = useRef<History>(EMPTY_HISTORY);
  const seen = useRef(value);
  const composing = useRef(false);
  const started = useRef<Snapshot | null>(null);
  const pending = useRef<Pending | null>(null);

  const emit = (next: string): void => {
    seen.current = next;
    onChange(next);
  };

  const go = (area: HTMLTextAreaElement, direction: 'undo' | 'redo'): void => {
    const step = travelled(history.current, seen.current, area.value, direction);
    history.current = step.history;
    if (step.to === null) return;
    area.value = step.to.value;
    area.setSelectionRange(step.to.selectionStart, step.to.selectionEnd);
    emit(step.to.value);
    moved(area);
  };

  const undoing = (
    area: HTMLTextAreaElement,
    event: InputEvent,
    direction: 'undo' | 'redo',
  ): void => {
    if (!event.cancelable) return;
    event.preventDefault();
    go(area, direction);
  };

  const heard = (event: InputEvent): void => {
    const area = areaRef.current;
    const intent = inputIntent(
      event.inputType,
      event.data,
      readOnly || event.isComposing || composing.current,
    );
    pending.current = null;
    if (area === null || intent === 'ignore') return;
    if (typeof intent === 'string') {
      undoing(area, event, intent);
      return;
    }
    pending.current = { before: snapshotOf(area), edit: intent };
  };
  const listening = useLatest(heard);
  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return undefined;
    const listener = (event: InputEvent): void => {
      listening()(event);
    };
    area.addEventListener('beforeinput', listener);
    return () => {
      area.removeEventListener('beforeinput', listener);
    };
  }, [listening]);

  const controls: CodeHistory = {
    change: (next) => {
      const area = areaRef.current;
      if (area !== null) {
        history.current = changed(
          history.current,
          seen.current,
          pending.current,
          snapshotOf(area),
          composing.current,
          Date.now(),
        );
      }
      pending.current = null;
      emit(next);
    },
    keyed: (press, event) => {
      const direction = historyKey(press, PLATFORM);
      if (direction === null) return false;
      event.preventDefault();
      const area = areaRef.current;
      if (area !== null && !readOnly) go(area, direction);
      return true;
    },
    replace: (edit) => {
      const area = areaRef.current;
      if (area === null || changesNothing(edit)) return;
      const before = snapshotOf(area);
      area.setRangeText(edit.text, edit.from, edit.to, 'end');
      area.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      history.current = committed(
        history.current,
        seen.current,
        before,
        snapshotOf(area),
        DISCRETE,
        Date.now(),
      );
      emit(area.value);
      moved(area);
    },
    composing: () => composing.current,
    compositionStart: () => {
      const area = areaRef.current;
      composing.current = true;
      pending.current = null;
      if (area === null) return;
      history.current = reconciled(history.current, seen.current, area.value);
      started.current = snapshotOf(area);
    },
    compositionEnd: () => {
      const area = areaRef.current;
      const before = started.current;
      started.current = null;
      if (area !== null && before !== null) {
        history.current = committed(
          history.current,
          before.value,
          before,
          snapshotOf(area),
          DISCRETE,
          Date.now(),
        );
      }
      // The key that ends a composition is still delivered to keydown.
      setTimeout(() => {
        composing.current = false;
      }, 0);
    },
  };
  return [areaRef, controls];
}
