import { Button, Link } from 'react-aria-components';
import type { ThemeSetting } from '#/widgets/shell/types/themeSetting';
import { ThemeControl } from '#/widgets/shell/ui/ThemeControl';
import styles from '#/widgets/shell/ui/RailFooter/RailFooter.module.css';

export function RailFooter({
  username,
  from,
  switchHref,
  theme,
  onSignOut,
}: {
  username: string;
  from: string | null;
  switchHref: string;
  theme: ThemeSetting;
  onSignOut: () => void;
}) {
  return (
    <div className={styles.footer}>
      <p className={styles.who}>
        Signed in as <strong>{username}</strong>
        {from === null ? null : <> from {from}</>}
      </p>
      <ThemeControl theme={theme} />
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
