import { Button, Link } from 'react-aria-components';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import { ThemeControl } from '#/features/shell/view/ThemeControl.tsx';
import styles from '#/features/shell/view/RailFooter.module.css';

export function RailFooter({
  username,
  signedInTo,
  tenant,
  switchHref,
  theme,
  onChooseTheme,
  onSignOut,
}: {
  username: string;
  signedInTo: string;
  tenant: string;
  switchHref: string;
  theme: ThemeChoice;
  onChooseTheme: (choice: ThemeChoice) => void;
  onSignOut: () => void;
}) {
  return (
    <div className={styles.footer}>
      <p className={styles.who}>
        Signed in as <strong>{username}</strong>
        {signedInTo === tenant ? null : <> from {signedInTo}</>}
      </p>
      <ThemeControl choice={theme} onChoose={onChooseTheme} />
      <div className={styles.actions}>
        <Link href={switchHref} className={styles.action ?? ''}>
          Switch tenant
        </Link>
        <Button onPress={onSignOut} className={styles.action ?? ''}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
