import { Button, Link } from 'react-aria-components';
import { useShellText } from '#/widgets/shell/use-cases/useShellText';
import type { ThemeChoice } from '#/shared/lib/services/theme';
import { ThemeControl } from '#/widgets/shell/ui/ThemeControl';
import styles from '#/widgets/shell/ui/RailFooter/RailFooter.module.css';

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
  const { signedInFrom } = useShellText();
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
