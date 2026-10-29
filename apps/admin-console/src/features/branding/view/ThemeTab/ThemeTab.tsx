import type { ThemeView } from '@odudu/contracts/admin';
import {
  DELETE_BODY,
  DELETE_LABEL,
  DELETE_TITLE,
  type PublishOutcome,
  type ThemeScope,
} from '#/features/branding/service';
import { useThemeTab } from '#/features/branding/usecase/useThemeTab';
import { ColoursSection, ContrastPanel } from '#/features/branding/view/ColoursSection';
import { ImagesSection } from '#/features/branding/view/ImagesSection';
import { StylesheetSection } from '#/features/branding/view/StylesheetSection';
import { ResetPanel, RevertPanel, VersionsPanel } from '#/features/branding/view/PublicationPanels';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import styles from '#/features/branding/view/ThemeTab/ThemeTab.module.css';

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
      <RevertPanel scope={scope} revert={theme.revert} />
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
