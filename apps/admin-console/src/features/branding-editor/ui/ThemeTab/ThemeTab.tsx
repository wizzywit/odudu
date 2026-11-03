import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import { useThemeTab } from '#/features/branding-editor/use-cases/useThemeTab';
import { ColoursSection, ContrastPanel } from '#/features/branding-editor/ui/ColoursSection';
import { ImagesSection } from '#/features/branding-editor/ui/ImagesSection';
import { StylesheetSection } from '#/features/branding-editor/ui/StylesheetSection';
import {
  ResetPanel,
  RevertPanel,
  VersionsPanel,
} from '#/features/branding-editor/ui/PublicationPanels';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import styles from '#/features/branding-editor/ui/ThemeTab/ThemeTab.module.css';

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
  const { deletion, deleteWords } = theme;
  return (
    <div className={styles.tab}>
      <ColoursSection colours={theme.colours} />
      <ContrastPanel contrast={theme.contrast} />
      <ImagesSection images={theme.images} onDelete={deletion.ask} />
      <StylesheetSection stylesheet={theme.stylesheet} />
      <div className={styles.revert}>
        <RevertPanel revert={theme.revert} />
      </div>
      <VersionsPanel versions={theme.versions} />
      <ResetPanel reset={theme.reset} />
      <ConfirmDialog
        isOpen={deletion.asking !== null}
        title={deleteWords.title}
        consequence={deleteWords.consequence}
        confirmLabel={deleteWords.confirmLabel}
        tone="danger"
        busy={deletion.busy}
        problem={deletion.problem}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </div>
  );
}
