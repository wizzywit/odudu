import { MAIL_AS_LABEL, MAIL_TENANT_OWN } from '#/features/branding/service';
import type { MailTab } from '#/features/branding/usecase/useMailTab';
import { Button } from '#/shared/view/Button';
import { ClientPicker } from '#/shared/view/ClientPicker';

// Which look the preview shows: the tenant's own, or the mail a sign-in of one
// of its clients sends. A client is chosen the way a scope's clients are.
export function MailClientChoice({ mail }: { mail: MailTab }) {
  return (
    <div>
      <ClientPicker
        label={MAIL_AS_LABEL}
        picker={mail.picker}
        selected={mail.client === null ? [] : [mail.client.id]}
        selectionMode="single"
        onChange={mail.chooseClient}
      />
      {mail.client === null ? null : (
        <Button size="small" onPress={mail.showTenantOwn}>
          {MAIL_TENANT_OWN}
        </Button>
      )}
    </div>
  );
}
