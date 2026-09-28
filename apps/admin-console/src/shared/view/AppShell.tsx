import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '#/shared/view/Button.tsx';
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

function useShortcut(onPress: (() => void) | undefined): void {
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });
  const enabled = onPress !== undefined;
  useEffect(() => {
    if (!enabled) return undefined;
    const press = (event: KeyboardEvent): void => {
      if (event.key !== SHORTCUT || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      latest.current?.();
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
  readonly label: string;
  readonly onPress: () => void;
  readonly focusRef: RefObject<HTMLButtonElement | null>;
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
      <kbd className={styles.shortcut}>{SHORTCUT}</kbd>
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
  children,
}: {
  readonly rail: ReactNode;
  readonly contextBar?: ReactNode;
  readonly brand?: ReactNode;
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
  readonly children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeOnDestination = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
      setSheetOpen(false);
    }
  };
  const collapseButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const collapsible = onCollapsedChange !== undefined;
  const toggle = (): void => {
    const active = document.activeElement;
    moveFocus.current = active === collapseButton.current || active === expandButton.current;
    onCollapsedChange?.(!collapsed);
  };
  useShortcut(collapsible ? toggle : undefined);
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
          <section aria-label="Menu" className={styles.rail}>
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
