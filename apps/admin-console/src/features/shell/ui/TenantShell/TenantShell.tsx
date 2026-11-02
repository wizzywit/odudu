import type { ReactNode } from 'react';
import {
  SignedInElsewhere,
  SigningIn,
  useTenantAccess,
  useTenantMissing,
} from '#/features/session';
import { areasLabel, brandText } from '#/features/shell/services/frame';
import { useShell } from '#/features/shell/use-cases/useShell';
import { RailFooter } from '#/features/shell/ui/RailFooter';
import { TenantNotFound } from '#/features/shell/ui/TenantNotFound';
import { PRODUCT_NAME } from '#/shared/services/product';
import { isTenantName, type Principal } from '#/shared/services/principal';
import { AppShell } from '#/shared/ui/AppShell';
import { BrandLine } from '#/shared/ui/BrandLine';
import { ContextBar } from '#/shared/ui/ContextBar';
import { LostFrame } from '#/shared/ui/LostFrame';
import { PageNotFound } from '#/shared/ui/PageNotFound';
import { Rail } from '#/shared/ui/Rail';
import styles from '#/features/shell/ui/TenantShell/TenantShell.module.css';

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
  const missing = useTenantMissing(tenant);
  if (missing === true) {
    return (
      <LostFrame brand={PRODUCT_NAME}>
        <TenantNotFound tenant={tenant} chooseHref={shell.switchHref} />
      </LostFrame>
    );
  }
  return (
    <AppShell
      brand={brandText(tenant)}
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
          label={areasLabel(tenant)}
          groups={shell.groups}
          checking={shell.checking}
          {...(shell.currentHref === undefined ? {} : { currentHref: shell.currentHref })}
          header={
            <strong className={styles.brand}>
              <BrandLine>{brandText(tenant)}</BrandLine>
            </strong>
          }
          footer={
            <RailFooter
              username={shell.username}
              signedInTo={shell.signedInTo}
              tenant={tenant}
              switchHref={shell.switchHref}
              theme={shell.theme}
              onChooseTheme={shell.chooseTheme}
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
    return <SigningIn tenant={access.tenant} ended={access.ended} />;
  }
  if (access.kind === 'elsewhere') {
    return (
      <SignedInElsewhere principal={access.principal} tenant={tenant} onSignIn={access.signIn} />
    );
  }
  return (
    <SignedInShell tenant={tenant} principal={access.principal}>
      {children}
    </SignedInShell>
  );
}

export function TenantShell({ tenant, children }: { tenant: string; children: ReactNode }) {
  if (!isTenantName(tenant)) {
    return (
      <LostFrame brand={PRODUCT_NAME}>
        <PageNotFound />
      </LostFrame>
    );
  }
  return <Access tenant={tenant}>{children}</Access>;
}
