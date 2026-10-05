import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import type { Toast } from '#/shared/service/toast.ts';
import { Button } from '#/shared/view/Button';
import styles from '#/shared/view/Toasts.module.css';

const SUCCESS_LIFETIME_MS = 5_000;

// Counts down only while running, keeping what is left across pauses.
function useCountdown(running: boolean, ms: number, onElapsed: () => void): void {
  const remaining = useRef(ms);
  const elapsed = useRef(onElapsed);
  useEffect(() => {
    elapsed.current = onElapsed;
  });
  useEffect(() => {
    if (!running) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => {
      elapsed.current();
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [running]);
}

function ToastItem({
  toast,
  onDismiss,
  onFocusLost,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  onFocusLost: (id: string) => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  const lost = useRef(onFocusLost);
  useEffect(() => {
    lost.current = onFocusLost;
  });
  // A layout cleanup runs while the item is still in the document, so it can
  // tell whether the focus is about to go with it.
  useLayoutEffect(() => {
    const node = item.current;
    const id = toast.id;
    return () => {
      if (node?.contains(document.activeElement) === true) lost.current(id);
    };
  }, [toast.id]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = (): void => {
    onDismiss(toast.id);
  };
  // An error stays until dismissed (WCAG 2.2.1); a success waits for the reader.
  useCountdown(toast.tone === 'success' && !hovered && !focused, SUCCESS_LIFETIME_MS, dismiss);

  const leave = (event: FocusEvent<HTMLLIElement>): void => {
    if (!(
      event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
    )) {
      setFocused(false);
    }
  };

  return (
    <li
      ref={item}
      data-toast={toast.id}
      className={styles.toast}
      data-tone={toast.tone}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={leave}
    >
      <div className={styles.body} {...(toast.tone === 'error' ? { role: 'alert' } : {})}>
        <span className={styles.tone}>{toast.tone === 'success' ? 'Done' : 'Error'}</span>
        <p className={styles.message}>{toast.message}</p>
      </div>
      <Button
        size="small"
        variant="quiet"
        onPress={dismiss}
        aria-label={`Dismiss: ${toast.message}`}
      >
        Dismiss
      </Button>
    </li>
  );
}

// Errors come first and stay until dismissed; each list announces its own way,
// so an error is never heard twice. The region is React Aria's top layer, so
// an open modal's aria-hidden sweep leaves it where a screen reader can hear it.
export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: string) => void;
}) {
  const region = useRef<HTMLElement>(null);
  const shown = useRef<readonly string[]>([]);
  const orphaned = useRef<string | undefined>(undefined);
  const errors = toasts.filter((toast) => toast.tone === 'error');
  const successes = toasts.filter((toast) => toast.tone === 'success');
  const order = [...errors, ...successes].map((toast) => toast.id);

  // Focus leaving with a dismissed toast goes to the next one, else the page.
  useLayoutEffect(() => {
    const lost = orphaned.current;
    const previous = shown.current;
    orphaned.current = undefined;
    shown.current = order;
    if (lost === undefined) return;
    const next = previous.slice(previous.indexOf(lost) + 1).find((id) => order.includes(id));
    const items = [...(region.current?.querySelectorAll<HTMLElement>('[data-toast]') ?? [])];
    const target =
      next === undefined
        ? document.getElementById('main')
        : items.find((node) => node.dataset.toast === next)?.querySelector('button');
    target?.focus();
  });

  const item = (toast: Toast) => (
    <ToastItem
      key={toast.id}
      toast={toast}
      onDismiss={onDismiss}
      onFocusLost={(id) => {
        orphaned.current = id;
      }}
    />
  );
  return (
    <section
      ref={region}
      aria-label="Notifications"
      className={styles.region}
      data-react-aria-top-layer
    >
      <ol className={styles.list}>{errors.map(item)}</ol>
      <ol aria-live="polite" className={styles.list}>
        {successes.map(item)}
      </ol>
    </section>
  );
}
