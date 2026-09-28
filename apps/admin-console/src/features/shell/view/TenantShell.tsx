import type { ReactNode } from 'react';
import {
  isTenantName,
  SignedInElsewhere,
  SigningIn,
  useTenantAccess,
  type Principal,
} from '#/features/session/index.ts';
import { useShell } from '#/features/shell/usecase/useShell.ts';
import { PageNotFound } from '#/features/shell/view/PageNotFound.tsx';
import { RailFooter } from '#/features/shell/view/RailFooter.tsx';
import { AppShell } from '#/shared/view/AppShell.tsx';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import { Rail } from '#/shared/view/Rail.tsx';
import styles from '#/features/shell/view/TenantShell.module.css';

function SignedInShell({
  tenant,
  principal,
  children,
}: {
  readonly tenant: string;
  readonly principal: Principal;
  readonly children: ReactNode;
}) {
  const shell = useShell(tenant, principal);
  return (
    <AppShell
      brand={`odudu · ${tenant}`}
      collapsed={shell.collapsed}
      onCollapsedChange={shell.setCollapsed}
      contextBar={shell.systemAuthority ? <ContextBar tenant={tenant} /> : undefined}
      rail={
        <Rail
          label={`Areas of ${tenant}`}
          groups={shell.groups}
          {...(shell.currentHref === undefined ? {} : { currentHref: shell.currentHref })}
          header={<strong className={styles.brand}>odudu · {tenant}</strong>}
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

function Access({ tenant, children }: { readonly tenant: string; readonly children: ReactNode }) {
  const access = useTenantAccess(tenant);
  if (access.kind === 'signing-in') return <SigningIn tenant={tenant} ended={access.ended} />;
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

export function TenantShell({
  tenant,
  children,
}: {
  readonly tenant: string;
  readonly children: ReactNode;
}) {
  if (!isTenantName(tenant)) {
    return (
      <main id="main" tabIndex={-1} className={styles.lost}>
        <PageNotFound />
      </main>
    );
  }
  return <Access tenant={tenant}>{children}</Access>;
}
