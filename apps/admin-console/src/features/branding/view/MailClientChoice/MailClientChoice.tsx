import { MAIL_AS_LABEL, MAIL_TENANT_OWN, mailClientSelection } from '#/features/branding/service';
import type { MailTab } from '#/features/branding/usecase/useMailTab';
import { Button } from '#/shared/view/Button';
import { ClientPicker } from '#/shared/view/ClientPicker';
import styles from '#/features/branding/view/MailClientChoice/MailClientChoice.module.css';

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
