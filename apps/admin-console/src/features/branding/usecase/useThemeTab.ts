import type { ThemeView } from '@odudu/contracts/admin';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  contrastReport,
  type PublishOutcome,
  type ContrastReport,
  type ThemeScope,
} from '#/features/branding/service';
import { useColours, type Colours } from '#/features/branding/usecase/useColours';
import { useImageDeletion, type ImageAsk } from '#/features/branding/usecase/useImageDeletion';
import { useImages, type Images } from '#/features/branding/usecase/useImages';
import { useStylesheet, type Stylesheet } from '#/features/branding/usecase/useStylesheet';
import { useRevert, type Revert } from '#/features/branding/usecase/useRevert';
import { useThemeReset } from '#/features/branding/usecase/useThemeReset';
import { useVersions, type Versions } from '#/features/branding/usecase/useVersions';
import type { Confirming, Removal } from '#/shared/usecase/useConfirmedChange';

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
