import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '#/shared/view/Button.tsx';
import { KeyHint } from '#/shared/view/KeyHint.tsx';
import styles from '#/shared/view/AppShell.module.css';

const SHORTCUT = '[';

// A key typed into a field is text, not a command.
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="dialog"]') !== null)
  );
}

// AltGr reports Control with Alt, and some layouts need Option for `[`;
// Control alone and Command are other people's shortcuts.
function claimedElsewhere(event: KeyboardEvent): boolean {
  return (event.ctrlKey && !event.altKey) || event.metaKey;
}

function useShortcut(onPress: (() => void) | undefined, paused: boolean): void {
  const latest = useRef({ onPress, paused });
  useEffect(() => {
    latest.current = { onPress, paused };
  });
  const enabled = onPress !== undefined;
  useEffect(() => {
    if (!enabled) return undefined;
    const press = (event: KeyboardEvent): void => {
      if (event.key !== SHORTCUT || event.defaultPrevented || latest.current.paused) return;
      if (claimedElsewhere(event) || typing(event.target)) return;
      event.preventDefault();
      latest.current.onPress?.();
    };
    document.addEventListener('keydown', press);
    return () => {
      document.removeEventListener('keydown', press);
    };
  }, [enabled]);
}

function Toggle({
  label,
  onPress,
  focusRef,
}: {
  label: string;
  onPress: () => void;
  focusRef: RefObject<HTMLButtonElement | null>;
}) {
  // A native button, because React Aria's drops aria-keyshortcuts.
  return (
    <span className={styles.toggle}>
      <button
        ref={focusRef}
        type="button"
        className={styles.toggleButton}
        aria-keyshortcuts={SHORTCUT}
        onClick={onPress}
      >
        {label}
      </button>
      <span className={styles.shortcut}>
        <KeyHint lead="or press" keys={[SHORTCUT]} announced />
      </span>
    </span>
  );
}

// Collapsed, the rail is gone rather than narrowed: the page takes the top
// bar and its menu sheet, as it does on a phone, and the context bar stays.
export function AppShell({
  rail,
  contextBar,
  brand = 'Odudu',
  collapsed = false,
  onCollapsedChange,
  shortcutsPaused = false,
  children,
}: {
  rail: ReactNode;
  contextBar?: ReactNode;
  brand?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  // While a dialog is open the shortcut would act behind it.
  shortcutsPaused?: boolean;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // A destination, or an action such as signing out, is the sheet's work
  // done: it closes, so a dialog the action raises never sits on top of it.
  // As a transition, so the control is still mounted when React Aria's own
  // click handler runs: a discrete update would unmount it first in Chromium.
  const closeOnDestination = (event: MouseEvent<HTMLDivElement>): void => {
    if (
      event.target instanceof Element &&
      event.target.closest('a[href], button, label') !== null
    ) {
      startTransition(() => {
        setSheetOpen(false);
      });
    }
  };
  const railColumn = useRef<HTMLElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const collapsible = onCollapsedChange !== undefined;
  const toggle = (): void => {
    const active = document.activeElement;
    moveFocus.current =
      active === expandButton.current ||
      (active !== null && railColumn.current?.contains(active) === true);
    onCollapsedChange?.(!collapsed);
  };
  useShortcut(collapsible ? toggle : undefined, shortcutsPaused || sheetOpen);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? expandButton : collapseButton).current?.focus();
  }, [collapsed]);
  const railShown = !(collapsible && collapsed);

  return (
    <div className={styles.shell} data-shell>
      <div className={styles.frame} data-collapsed={railShown ? undefined : true}>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        {railShown ? (
          <section ref={railColumn} aria-label="Menu" className={styles.rail}>
            <div className={styles.railBody}>{rail}</div>
            {collapsible ? (
              <div className={styles.railFoot}>
                <Toggle label="Collapse menu" onPress={toggle} focusRef={collapseButton} />
              </div>
            ) : null}
          </section>
        ) : null}
        <div className={styles.column}>
          <header className={styles.topBar}>
            <span className={styles.brand}>{brand}</span>
            <span className={styles.topActions}>
              {railShown ? null : (
                <span className={styles.expand}>
                  <Toggle label="Expand menu" onPress={toggle} focusRef={expandButton} />
                </span>
              )}
              <DialogTrigger isOpen={sheetOpen} onOpenChange={setSheetOpen}>
                <Button size="small">Menu</Button>
                <ModalOverlay isDismissable className={styles.overlay ?? ''}>
                  <Modal className={styles.sheet ?? ''}>
                    <Dialog aria-label="Navigation" className={styles.dialog ?? ''}>
                      <div className={styles.sheetRail} onClickCapture={closeOnDestination}>
                        {rail}
                      </div>
                    </Dialog>
                  </Modal>
                </ModalOverlay>
              </DialogTrigger>
            </span>
          </header>
          {contextBar}
          <main id="main" tabIndex={-1} className={styles.main}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
