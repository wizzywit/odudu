import type { ReactNode } from 'react';
import type { ClientRecord } from '#/pages/clients/types/clientRecord';
import {
  BRANDING_SECTIONS_LABEL,
  BRANDING_TAB_LABELS,
  PagesPanel,
  PublicationBar,
  SCOPED_TABS,
  ThemePanel,
  type ScopedTab,
} from '#/features/branding-editor';
import { type BrandingOffer } from '#/pages/clients/services/branding';
import { useClientBranding } from '#/pages/clients/use-cases/useClientBranding';
import { Note, NoteCode } from '#/shared/ui/Note';
import { ReadGate } from '#/shared/ui/ReadGate';
import { recordTab } from '#/shared/ui/RecordTab';
import { Tabs } from '#/shared/ui/Tabs';
import { TouchTargets } from '#/shared/ui/TouchTargets';

function Editing({ tenant, id }: { tenant: string; id: string }) {
  const page = useClientBranding(tenant, id);
  const { branding } = page;
  return (
    <div className={recordTab.tab}>
      <p className={recordTab.rule}>{page.lead}</p>
      <ReadGate read={branding.record} label={page.loading} fields={4} failed={page.failed}>
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
  held,
}: {
  tenant: string;
  client: ClientRecord;
  offer: BrandingOffer;
  held: { lead: string; needs: string };
}) {
  if (offer === 'checking') return null;
  if (offer === 'held') {
    return (
      <div className={recordTab.tab}>
        <Note>
          {`${held.lead} `}
          <NoteCode>{held.needs}</NoteCode>.
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
