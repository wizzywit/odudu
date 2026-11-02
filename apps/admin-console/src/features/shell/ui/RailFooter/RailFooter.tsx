import { Button, Link } from 'react-aria-components';
import { signedInFrom } from '#/features/shell/services/frame';
import type { ThemeChoice } from '#/shared/services/theme';
import { ThemeControl } from '#/features/shell/ui/ThemeControl';
import styles from '#/features/shell/ui/RailFooter/RailFooter.module.css';

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
  const from = signedInFrom(signedInTo, tenant);
  return (
    <div className={styles.footer}>
      <p className={styles.who}>
        Signed in as <strong>{username}</strong>
        {from === null ? null : <> from {from}</>}
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
