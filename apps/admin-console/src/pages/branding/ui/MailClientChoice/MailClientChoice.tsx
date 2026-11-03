import type { MailTab } from '#/pages/branding/use-cases/useMailTab';
import { Button } from '#/shared/ui/Button';
import { ClientPicker } from '#/entities/client';
import styles from '#/pages/branding/ui/MailClientChoice/MailClientChoice.module.css';

// Which look the preview shows: the tenant's own, or the mail a sign-in of one
// of its clients sends. A client is chosen the way a scope's clients are.
export function MailClientChoice({ mail }: { mail: MailTab }) {
  const { clientChoice } = mail;
  return (
    <div className={styles.choice}>
      <div className={styles.picker}>
        <ClientPicker
          label={clientChoice.label}
          picker={mail.picker}
          selected={clientChoice.selected}
          selectionMode="single"
          onChange={mail.chooseClient}
        />
      </div>
      {clientChoice.tenantOwn === null ? null : (
        <Button size="small" onPress={mail.showTenantOwn}>
          {clientChoice.tenantOwn}
        </Button>
      )}
    </div>
  );
}
