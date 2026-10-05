import { useState, type ReactNode } from 'react';
import { CheckboxButton, CheckboxField } from 'react-aria-components';
import { Button } from '#/shared/view/Button';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { DialogFrame } from '#/shared/view/DialogFrame.tsx';
import styles from '#/shared/view/SecretDialog.module.css';

// The secret is shown once, in one text node, and nowhere else: not in an
// attribute, a title, a toast, the URL or a log line.
export function SecretDialog({ secret, ...props }: SecretProps & { secret: string | null }) {
  // Each new secret remounts the dialog, so its acknowledgement starts
  // unticked; a counter keys it, since a key is kept in React's tree.
  const [shown, setShown] = useState({ secret, generation: 0 });
  if (shown.secret !== secret) setShown({ secret, generation: shown.generation + 1 });
  if (secret === null) return null;
  return <OpenSecret key={String(shown.generation)} secret={secret} {...props} />;
}

interface SecretProps {
  title: string;
  // Names the secret in running text: "client secret", "one-time password".
  label: string;
  children?: ReactNode;
  onClose: () => void;
}

function OpenSecret({ secret, title, label, children, onClose }: SecretProps & { secret: string }) {
  const [stored, setStored] = useState(false);
  return (
    <DialogFrame
      isOpen
      title={title}
      description={
        <>
          {children === undefined ? null : <>{children} </>}
          This is the only time the {label} is shown. Copy it and store it before you close this
          dialog.
        </>
      }
      {...(stored ? { onEscape: onClose } : {})}
      actions={
        <Button variant="primary" isDisabled={!stored} onPress={onClose}>
          Close
        </Button>
      }
    >
      <div className={styles.secret}>
        <CopyValue label={label} value={secret} />
      </div>
      <CheckboxField isSelected={stored} onChange={setStored} className={styles.acknowledge ?? ''}>
        <CheckboxButton className={styles.checkbox ?? ''}>
          <span className={styles.box} aria-hidden="true" />
          <span>I have stored the {label}. It will not be shown again.</span>
        </CheckboxButton>
      </CheckboxField>
    </DialogFrame>
  );
}
