import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from 'react';
import { PLATFORM } from '#/shared/lib/platform/platform';
import { focusedElement, listenToKeys, returnFocusTo } from '#/shared/lib/platform/documentKeys';
import { shortcutName, shortcutOutcome } from '#/entities/assistant/services/shortcut';
import { ASSISTANT_WORDING } from '#/entities/assistant/services/wording';
import { useAssistantStatus } from '#/entities/assistant/use-cases/useAssistantStatus';
import type { AssistantView } from '#/entities/assistant/services/gate';

export interface AssistantEntry {
  // The gate is open and the tenant has the assistant on: nothing below
  // is drawn, and no shortcut listens, while this is false.
  shown: boolean;
  open: boolean;
  panelId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  view: AssistantView;
  words: typeof ASSISTANT_WORDING;
  // The chord as aria-keyshortcuts names it.
  shortcut: string;
  // Opens the panel, or closes it when it is open, remembering `opener`.
  toggle: (opener: HTMLElement | null) => void;
  close: () => void;
}

// The assistant's one place in the shell: whether it is offered, whether its
// panel is open, and the shortcut that opens it. Closing returns the focus to
// whatever opened it. `available` is the gate whoami decides; `paused` is true
// while a dialog is open, when the shortcut would act behind it.
export function useAssistantEntry(
  tenant: string,
  available: boolean,
  paused: boolean,
): AssistantEntry {
  const view = useAssistantStatus(tenant, available);
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = view.enabled;
  const open = shown && opened;

  const close = (): void => {
    setOpened(false);
    returnFocusTo(opener.current);
    opener.current = null;
  };
  const toggle = (from: HTMLElement | null): void => {
    if (open) {
      close();
      return;
    }
    opener.current = from;
    setOpened(true);
  };
  const press = useEffectEvent((event: KeyboardEvent): void => {
    const outcome = shortcutOutcome(event, PLATFORM, { paused, open });
    if (outcome === 'ignore') return;
    event.preventDefault();
    if (outcome === 'focus') headingRef.current?.focus();
    else toggle(focusedElement());
  });
  useEffect(() => {
    if (!shown) return undefined;
    return listenToKeys((event) => {
      press(event);
    });
  }, [shown]);

  return {
    shown,
    open,
    panelId,
    headingRef,
    view,
    words: ASSISTANT_WORDING,
    shortcut: shortcutName(PLATFORM),
    toggle,
    close,
  };
}
