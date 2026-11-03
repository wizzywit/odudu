import type { ThemeView } from '#/features/branding/types/theme';
import type { PublishOutcome } from '#/features/branding/services/publishOutcome';
import type { ThemeScope } from '#/features/branding/services/themeScope';
import { DELETE_BODY, DELETE_TITLE } from '#/features/branding/services/imageRefusals';
import { DELETE_LABEL } from '#/features/branding/services/imageSection';
import { useThemeTab } from '#/features/branding/use-cases/useThemeTab';
import { ColoursSection, ContrastPanel } from '#/features/branding/ui/ColoursSection';
import { ImagesSection } from '#/features/branding/ui/ImagesSection';
import { StylesheetSection } from '#/features/branding/ui/StylesheetSection';
import { ResetPanel, RevertPanel, VersionsPanel } from '#/features/branding/ui/PublicationPanels';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import styles from '#/features/branding/ui/ThemeTab/ThemeTab.module.css';

export function ThemeTab({
  tenant,
  scope,
  view,
  tag,
  gone,
  published,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
  published: PublishOutcome;
}) {
  const theme = useThemeTab({ tenant, scope, view, tag, gone, published });
  const { deletion } = theme;
  return (
    <div className={styles.tab}>
      <ColoursSection scope={scope} view={view} colours={theme.colours} />
      <ContrastPanel report={theme.report} />
      <ImagesSection scope={scope} view={view} images={theme.images} onDelete={deletion.ask} />
      <StylesheetSection tenant={tenant} scope={scope} view={view} stylesheet={theme.stylesheet} />
      <div className={styles.revert}>
        <RevertPanel scope={scope} tab="theme" revert={theme.revert} />
      </div>
      <VersionsPanel versions={theme.versions} />
      <ResetPanel scope={scope} reset={theme.reset} />
      <ConfirmDialog
        isOpen={deletion.asking !== null}
        title={DELETE_TITLE}
        consequence={DELETE_BODY}
        confirmLabel={DELETE_LABEL}
        tone="danger"
        busy={deletion.busy}
        problem={deletion.problem}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </div>
  );
}
