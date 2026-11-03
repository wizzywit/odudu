import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { ScopeBranding } from '#/features/branding-editor/use-cases/useScopeBranding';
import { PagesTab } from '#/features/branding-editor/ui/PagesTab';
import { PreviewPane } from '#/features/branding-editor/ui/PreviewPane';
import { ThemeTab } from '#/features/branding-editor/ui/ThemeTab';
import { Workspace } from '#/features/branding-editor/ui/Workspace';

interface PanelProps {
  tenant: string;
  branding: ScopeBranding;
  view: ThemeView;
  tag: string;
}

// The theme editor of one scope beside the preview of its draft.
export function ThemePanel({ tenant, branding, view, tag }: PanelProps) {
  return (
    <Workspace
      aside={<PreviewPane preview={branding.preview} pickKind />}
      editor={
        <ThemeTab
          tenant={tenant}
          scope={branding.scope}
          view={view}
          tag={tag}
          gone={branding.record.gone}
          published={branding.published}
        />
      }
    />
  );
}

// The page templates of one scope beside the preview of the page being edited.
export function PagesPanel({ tenant, branding, view, tag }: PanelProps) {
  const { preview } = branding;
  return (
    <Workspace
      aside={<PreviewPane preview={preview} pickKind={false} />}
      editor={
        <PagesTab
          tenant={tenant}
          scope={branding.scope}
          view={view}
          tag={tag}
          gone={branding.record.gone}
          kind={preview.choice.kind}
          onKind={preview.setKind}
          published={branding.published}
        />
      }
    />
  );
}
