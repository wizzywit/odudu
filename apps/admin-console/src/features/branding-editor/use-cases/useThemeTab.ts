import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useThemeWrites } from '#/features/branding-editor/repository/useThemeWrites';
import { contrastReport, type ContrastReport } from '#/features/branding-editor/services/contrast';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import { useColours, type Colours } from '#/features/branding-editor/use-cases/useColours';
import {
  useImageDeletion,
  type ImageAsk,
} from '#/features/branding-editor/use-cases/useImageDeletion';
import { useImages, type Images } from '#/features/branding-editor/use-cases/useImages';
import { useStylesheet, type Stylesheet } from '#/features/branding-editor/use-cases/useStylesheet';
import { useRevert, type Revert } from '#/features/branding-editor/use-cases/useRevert';
import { useThemeReset } from '#/features/branding-editor/use-cases/useThemeReset';
import { useVersions, type Versions } from '#/features/branding-editor/use-cases/useVersions';
import type { Confirming, Removal } from '#/shared/use-cases/useConfirmedChange';

export interface ThemeTab {
  colours: Colours;
  images: Images;
  stylesheet: Stylesheet;
  deletion: Confirming<ImageAsk>;
  report: ContrastReport;
  revert: Revert;
  versions: Versions;
  reset: Removal;
}

export function useThemeTab({
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
}): ThemeTab {
  const colours = useColours({ tenant, scope, view, tag, gone });
  const images = useImages({ tenant, scope, view, tag, gone });
  const deletion = useImageDeletion(tenant, scope, images.forget);
  const writes = useThemeWrites(tenant, scope);
  const report = contrastReport(colours.save.values);
  return {
    colours,
    images,
    stylesheet: useStylesheet({ tenant, scope, view, tag, gone, published }),
    deletion,
    report,
    revert: useRevert({ tenant, scope, view, tag, tab: 'theme' }),
    versions: useVersions(tenant, scope, writes),
    reset: useThemeReset(tenant, scope, writes),
  };
}
