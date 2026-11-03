import { MAIL_AS_LABEL, MAIL_TENANT_OWN } from '#/pages/branding/services/mailPreview';
import { mailClientSelection } from '#/pages/branding/services/mailChoice';
import type { MailTab } from '#/pages/branding/use-cases/useMailTab';
import { Button } from '#/shared/ui/Button';
import { ClientPicker } from '#/entities/client';
import styles from '#/pages/branding/ui/MailClientChoice/MailClientChoice.module.css';

// Which look the preview shows: the tenant's own, or the mail a sign-in of one
// of its clients sends. A client is chosen the way a scope's clients are.
export function MailClientChoice({ mail }: { mail: MailTab }) {
  return (
    <div className={styles.choice}>
      <div className={styles.picker}>
        <ClientPicker
          label={MAIL_AS_LABEL}
          picker={mail.picker}
          selected={mailClientSelection(mail.client)}
          selectionMode="single"
          onChange={mail.chooseClient}
        />
      </div>
      {mail.client === null ? null : (
        <Button size="small" onPress={mail.showTenantOwn}>
          {MAIL_TENANT_OWN}
        </Button>
      )}
    </div>
  );
}
