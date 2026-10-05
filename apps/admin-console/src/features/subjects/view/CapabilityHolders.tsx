import { useId, type ReactNode } from 'react';
import { Link } from 'react-aria-components';
import {
  useCapabilityHolders,
  useHeldLines,
  type Holder,
} from '#/features/subjects/usecase/useCapabilityHolders.ts';
import { SubjectCapabilities } from '#/features/subjects/view/CapabilityEditor.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { Count } from '#/shared/view/Count.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { ListSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/subjects/view/CapabilityHolders.module.css';

function Row({
  tenant,
  authorityTenant,
  holder,
  open,
  canChange,
  onToggle,
  actions,
}: {
  tenant: string;
  authorityTenant: string;
  holder: Holder;
  open: boolean;
  canChange: boolean;
  onToggle: () => void;
  actions: ReactNode;
}) {
  const lines = useHeldLines(tenant, holder);
  const editor = useId();
  return (
    <li className={styles.holder}>
      <div className={styles.head}>
        <Link href={holder.href} className={styles.name ?? ''}>
          {holder.name}
        </Link>
        {holder.subject.enabled ? null : <StatusTag tone="danger">disabled</StatusTag>}
      </div>
      <ul aria-label={`What ${holder.name} holds`} className={styles.held}>
        {lines.map((line) => (
          <li key={line.holding}>
            <code>{line.label}</code>
            {line.how === '' ? null : <span className={styles.how}>{` · ${line.how}`}</span>}
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        {canChange ? (
          <Button size="small" aria-expanded={open} aria-controls={editor} onPress={onToggle}>
            {open ? `Close ${holder.name}’s capabilities` : `Change ${holder.name}’s capabilities`}
          </Button>
        ) : null}
        {actions}
      </div>
      <div id={editor} className={styles.editor}>
        {open ? (
          <SubjectCapabilities
            tenant={tenant}
            subject={holder.subject}
            authorityTenant={authorityTenant}
          />
        ) : null}
      </div>
    </li>
  );
}

// Everybody holding an admin capability in a tenant, with what each holds
// and how, each one's own set open for change in place.
export function CapabilityHolders({
  tenant,
  authorityTenant = tenant,
  canChange,
  actionsOf,
}: {
  tenant: string;
  authorityTenant?: string;
  // False once whoami says a change would be refused.
  canChange: boolean;
  actionsOf?: (holder: Holder) => ReactNode;
}) {
  const page = useCapabilityHolders(tenant);
  const label = `Administrators of ${tenant}`;
  switch (page.status) {
    case 'loading':
      return <ListSkeleton label="Loading administrators" />;
    case 'refused':
      return <CapabilityNote capability="view-users">{label}</CapabilityNote>;
    case 'failed':
      return (
        <EmptyState
          variant="failed"
          title="The administrators could not be loaded"
          action={<Button onPress={page.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
    case 'ready':
      break;
  }
  if (page.holders.length === 0) {
    return (
      <EmptyState variant="nothing-yet" title="No administrators yet">
        {`Nobody holds an admin capability in ${tenant}, so nobody can sign in to its console until one is added.`}
      </EmptyState>
    );
  }
  return (
    <div className={styles.holders}>
      <Count
        count={page.holders.length}
        capped={false}
        noun={{ one: 'administrator', other: 'administrators' }}
      />
      <ul aria-label={label} className={styles.list}>
        {page.holders.map((holder) => (
          <Row
            key={holder.subject.id}
            tenant={tenant}
            authorityTenant={authorityTenant}
            holder={holder}
            open={page.open === holder.subject.id}
            canChange={canChange}
            onToggle={() => {
              page.toggle(holder.subject.id);
            }}
            actions={actionsOf?.(holder) ?? null}
          />
        ))}
      </ul>
    </div>
  );
}
