import { useState, type MouseEvent, type ReactNode } from 'react';
import { Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/AppShell.module.css';

export function AppShell({
  rail,
  contextBar,
  brand = 'Odudu',
  children,
}: {
  readonly rail: ReactNode;
  readonly contextBar?: ReactNode;
  readonly brand?: ReactNode;
  readonly children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeOnDestination = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
      setSheetOpen(false);
    }
  };

  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <div className={styles.rail}>{rail}</div>
        <div className={styles.column}>
          <header className={styles.topBar}>
            <span className={styles.brand}>{brand}</span>
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
