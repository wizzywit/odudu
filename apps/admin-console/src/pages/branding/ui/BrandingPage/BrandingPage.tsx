import {
  type OfferedTab,
  PagesPanel,
  PublicationBar,
  ThemePanel,
  Workspace,
} from '#/features/branding-editor';
import type { ReactNode } from 'react';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useBrandingPage } from '#/pages/branding/use-cases/useBrandingPage';
import { LanguagesTab } from '#/pages/branding/ui/LanguagesTab';
import { MailInherits, MailPreview } from '#/pages/branding/ui/MailTab';
import { RecordPage } from '#/shared/ui/RecordPage';
import { TouchTargets } from '#/shared/ui/TouchTargets';

const AREA = areaAt('branding');

function Branding({ tenant }: { tenant: string }) {
  const page = useBrandingPage(tenant);
  const { branding, mail } = page;
  const { view, tag } = branding;
  const panels: Readonly<Record<OfferedTab, ReactNode>> | null =
    view === undefined || tag === null
      ? null
      : {
          theme: <ThemePanel tenant={tenant} branding={branding} view={view} tag={tag} />,
          pages: <PagesPanel tenant={tenant} branding={branding} view={view} tag={tag} />,
          mail: (
            <Workspace aside={<MailPreview mail={mail} />} editor={<MailInherits mail={mail} />} />
          ),
          languages: <LanguagesTab tenant={tenant} />,
        };
  return (
    <TouchTargets>
      <RecordPage
        record={branding.record}
        kicker={tenant}
        title={AREA.label}
        description={page.words.description}
        noun={page.words.noun}
        label={page.words.sectionsLabel}
        banner={
          view === undefined || tag === null ? null : (
            <PublicationBar
              tenant={tenant}
              branding={branding}
              view={view}
              tag={tag}
              tab={page.tab}
            />
          )
        }
        tab={page.tab}
        onTabChange={page.selectTab}
        tabs={page.tabs.map((tab) => ({
          ...tab,
          panel: panels === null ? null : panels[tab.id],
        }))}
      />
    </TouchTargets>
  );
}

export function BrandingPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <Branding tenant={tenant} />
    </AreaGate>
  );
}
