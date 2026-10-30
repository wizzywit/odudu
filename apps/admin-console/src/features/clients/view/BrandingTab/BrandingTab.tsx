import type { ReactNode } from 'react';
import type { ClientRecord } from '@odudu/contracts/admin';
import {
  BRANDING_SECTIONS_LABEL,
  BRANDING_TAB_LABELS,
  PagesPanel,
  PublicationBar,
  SCOPED_TABS,
  ThemePanel,
  type ScopedTab,
} from '#/features/branding';
import {
  BRANDING_FAILED,
  BRANDING_HELD,
  type BrandingOffer,
  BRANDING_LEAD,
  BRANDING_LOADING,
} from '#/features/clients/service';
import { useClientBranding } from '#/features/clients/usecase/useClientBranding';
import { andList } from '#/shared/service/format';
import type { AdminCapability } from '#/shared/service/principal';
import { Note, NoteCode } from '#/shared/view/Note';
import { ReadGate } from '#/shared/view/ReadGate';
import { recordTab } from '#/shared/view/RecordTab';
import { Tabs } from '#/shared/view/Tabs';
import { TouchTargets } from '#/shared/view/TouchTargets';

function Editing({ tenant, id }: { tenant: string; id: string }) {
  const page = useClientBranding(tenant, id);
  const { branding } = page;
  return (
    <div className={recordTab.tab}>
      <p className={recordTab.rule}>{BRANDING_LEAD}</p>
      <ReadGate read={branding.record} label={BRANDING_LOADING} fields={4} failed={BRANDING_FAILED}>
        {(view, tag) => {
          const panels: Readonly<Record<ScopedTab, ReactNode>> = {
            theme: <ThemePanel tenant={tenant} branding={branding} view={view} tag={tag} />,
            pages: <PagesPanel tenant={tenant} branding={branding} view={view} tag={tag} />,
          };
          return (
            <>
              <PublicationBar
                tenant={tenant}
                branding={branding}
                view={view}
                tag={tag}
                tab={page.tab}
              />
              <Tabs
                label={BRANDING_SECTIONS_LABEL}
                selectedKey={page.tab}
                onSelectionChange={page.selectTab}
                tabs={SCOPED_TABS.map((tab) => ({
                  id: tab,
                  label: BRANDING_TAB_LABELS[tab],
                  dirty: page.edited.has(tab),
                  changed: branding.changed.has(tab),
                  panel: panels[tab],
                }))}
              />
            </>
          );
        }}
      </ReadGate>
    </div>
  );
}

// The client's own look: what it sets over the tenant's theme, with a preview.
// Held back only for a missing capability: the theme applies no service-account
// ceiling, so a client the caller cannot change otherwise is edited here.
export function BrandingTab({
  tenant,
  client,
  offer,
  needs,
}: {
  tenant: string;
  client: ClientRecord;
  offer: BrandingOffer;
  needs: readonly AdminCapability[];
}) {
  if (offer === 'checking') return null;
  if (offer === 'held') {
    return (
      <div className={recordTab.tab}>
        <Note>
          {`${BRANDING_HELD} `}
          <NoteCode>{andList(needs)}</NoteCode>.
        </Note>
      </div>
    );
  }
  return (
    <TouchTargets>
      <Editing tenant={tenant} id={client.id} />
    </TouchTargets>
  );
}
