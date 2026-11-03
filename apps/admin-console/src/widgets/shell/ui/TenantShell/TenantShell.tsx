import type { ReactNode } from 'react';
import {
  SignedInElsewhere,
  SigningIn,
  useTenantAccess,
  useTenantMissing,
  type Principal,
} from '#/entities/session';
import { useShell } from '#/widgets/shell/use-cases/useShell';
import { useTenantFrame } from '#/widgets/shell/use-cases/useTenantFrame';
import { RailFooter } from '#/widgets/shell/ui/RailFooter';
import { TenantNotFound } from '#/widgets/shell/ui/TenantNotFound';
import { AppShell } from '#/shared/ui/AppShell';
import { BrandLine } from '#/shared/ui/BrandLine';
import { ContextBar } from '#/shared/ui/ContextBar';
import { LostFrame } from '#/shared/ui/LostFrame';
import { PageNotFound } from '#/shared/ui/PageNotFound';
import { Rail } from '#/shared/ui/Rail';
import styles from '#/widgets/shell/ui/TenantShell/TenantShell.module.css';

function SignedInShell({
  tenant,
  principal,
  children,
}: {
  tenant: string;
  principal: Principal;
  children: ReactNode;
}) {
  const shell = useShell(tenant, principal);
  const { productName } = useTenantFrame(tenant);
  const missing = useTenantMissing(tenant);
  if (missing === true) {
    return (
      <LostFrame brand={productName}>
        <TenantNotFound message={shell.notFoundText} chooseHref={shell.switchHref} />
      </LostFrame>
    );
  }
  return (
    <AppShell
      brand={shell.brand}
      collapsed={shell.collapsed}
      onCollapsedChange={shell.setCollapsed}
      shortcutsPaused={shell.dialogOpen}
      contextBar={
        shell.systemAuthority ? (
          <ContextBar tenant={tenant} backHref={shell.systemRecordHref} />
        ) : undefined
      }
      rail={
        <Rail
          label={shell.areasLabel}
          groups={shell.groups}
          checking={shell.checking}
          {...(shell.currentHref === undefined ? {} : { currentHref: shell.currentHref })}
          header={
            <strong className={styles.brand}>
              <BrandLine>{shell.brand}</BrandLine>
            </strong>
          }
          footer={
            <RailFooter
              username={shell.username}
              from={shell.signedInFrom}
              switchHref={shell.switchHref}
              theme={shell.theme}
              onSignOut={shell.signOut}
            />
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}

function Access({ tenant, children }: { tenant: string; children: ReactNode }) {
  const access = useTenantAccess(tenant);
  if (access.kind === 'signing-in') {
    return <SigningIn words={access.words} ended={access.ended} />;
  }
  if (access.kind === 'elsewhere') {
    return (
      <SignedInElsewhere
        principal={access.principal}
        words={access.words}
        onSignIn={access.signIn}
      />
    );
  }
  return (
    <SignedInShell tenant={tenant} principal={access.principal}>
      {children}
    </SignedInShell>
  );
}

export function TenantShell({ tenant, children }: { tenant: string; children: ReactNode }) {
  const { valid, productName } = useTenantFrame(tenant);
  if (!valid) {
    return (
      <LostFrame brand={productName}>
        <PageNotFound />
      </LostFrame>
    );
  }
  return <Access tenant={tenant}>{children}</Access>;
}
