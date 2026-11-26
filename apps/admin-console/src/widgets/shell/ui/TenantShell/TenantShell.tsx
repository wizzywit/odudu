import type { ReactNode } from 'react';
import {
  SignedInElsewhere,
  SigningIn,
  useTenantAccess,
  useTenantMissing,
  type Principal,
} from '#/entities/session';
import { AssistantGate, type AssistantPanelSlot } from '#/entities/assistant';
import { useAssistantAvailable } from '#/widgets/shell/use-cases/useAssistantAvailable';
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
  renderAssistantPanel,
  children,
}: {
  tenant: string;
  principal: Principal;
  renderAssistantPanel: (slot: AssistantPanelSlot) => ReactNode;
  children: ReactNode;
}) {
  const shell = useShell(tenant, principal);
  const assistant = useAssistantAvailable(tenant);
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
    <AssistantGate
      tenant={tenant}
      available={assistant.available}
      actingIn={assistant.actingIn}
      paused={shell.dialogOpen}
      renderPanel={renderAssistantPanel}
    >
      {({ control, panel, open }) => (
        <AppShell
          brand={shell.brand}
          collapsed={shell.collapsed}
          onCollapsedChange={shell.setCollapsed}
          shortcutsPaused={shell.dialogOpen}
          assistant={control}
          assistantPanel={panel}
          assistantOpen={open}
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
      )}
    </AssistantGate>
  );
}

function Access({
  tenant,
  renderAssistantPanel,
  children,
}: {
  tenant: string;
  renderAssistantPanel: (slot: AssistantPanelSlot) => ReactNode;
  children: ReactNode;
}) {
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
    <SignedInShell
      tenant={tenant}
      principal={access.principal}
      renderAssistantPanel={renderAssistantPanel}
    >
      {children}
    </SignedInShell>
  );
}

// `renderAssistantPanel` draws the assistant's panel, which is a widget of its
// own: this one cannot import a sibling, so the composition root hands it in.
export function TenantShell({
  tenant,
  renderAssistantPanel,
  children,
}: {
  tenant: string;
  renderAssistantPanel: (slot: AssistantPanelSlot) => ReactNode;
  children: ReactNode;
}) {
  const { valid, productName } = useTenantFrame(tenant);
  if (!valid) {
    return (
      <LostFrame brand={productName}>
        <PageNotFound />
      </LostFrame>
    );
  }
  return (
    <Access tenant={tenant} renderAssistantPanel={renderAssistantPanel}>
      {children}
    </Access>
  );
}
