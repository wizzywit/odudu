import type { Group } from '@odudu/contracts/admin';
import { useId } from 'react';
import { Link } from 'react-aria-components';
import { useGroupNode, type GroupNode } from '#/features/groups/usecase/useGroupsList.ts';
import { Button } from '#/shared/view/Button.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { ListSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/groups/view/GroupTree.module.css';

function Children({
  tenant,
  parent,
  children,
}: {
  tenant: string;
  parent: Group;
  children: GroupNode['children'];
}) {
  switch (children.status) {
    case 'loading':
      return <ListSkeleton label={`Loading the groups under ${parent.path}`} items={1} />;
    case 'failed':
    case 'refused':
      return (
        <div role="alert" className={styles.empty}>
          <p>{`The groups under ${parent.path} could not be loaded.`}</p>
          <Button size="small" onPress={children.retry}>
            Try again
          </Button>
        </div>
      );
    case 'ready':
      break;
  }
  if (children.rows.length === 0) {
    return <p className={styles.empty}>{`No groups under ${parent.path} yet.`}</p>;
  }
  return (
    <>
      <ul aria-label={`Under ${parent.path}`} className={styles.level}>
        {children.rows.map((group) => (
          <Node key={group.id} tenant={tenant} group={group} />
        ))}
      </ul>
      {children.next === null ? null : (
        <Button
          size="small"
          variant="quiet"
          isDisabled={children.loadingMore}
          onPress={children.loadMore}
        >
          {children.loadingMore
            ? `Loading more groups under ${parent.path}…`
            : `Load more groups under ${parent.path}`}
        </Button>
      )}
    </>
  );
}

function Node({ tenant, group }: { tenant: string; group: Group }) {
  const node = useGroupNode(tenant, group);
  const level = useId();
  return (
    <li className={styles.node}>
      <div className={styles.row}>
        <Link href={node.href} className={styles.name ?? ''}>
          {group.name}
        </Link>
        {group.default_for_new_subjects ? (
          <StatusTag tone="active">joined by every new subject</StatusTag>
        ) : null}
        {group.description === null || group.description === '' ? null : (
          <span className={styles.description}>{group.description}</span>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          size="small"
          variant="quiet"
          aria-expanded={node.open}
          aria-controls={level}
          onPress={node.toggle}
        >
          {node.open
            ? `Hide the groups under ${group.path}`
            : `Show the groups under ${group.path}`}
        </Button>
        <ButtonLink href={node.createHref} size="small" variant="quiet">
          {`Create a group under ${group.path}`}
        </ButtonLink>
      </div>
      {node.open ? (
        <div id={level} className={styles.under}>
          <Children tenant={tenant} parent={group} children={node.children} />
        </div>
      ) : null}
    </li>
  );
}

// One level at a time: a group's children are read when it is opened.
export function GroupTree({ tenant, roots }: { tenant: string; roots: readonly Group[] }) {
  return (
    <ul aria-label="Groups" className={styles.tree}>
      {roots.map((group) => (
        <Node key={group.id} tenant={tenant} group={group} />
      ))}
    </ul>
  );
}
