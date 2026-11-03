import type { ThemeBodyRequest } from '#/features/branding-editor/types/theme';
import type { ThemeView } from '#/features/branding-editor/types/theme';
import { nullWhenBlank } from '#/shared/lib/services/format';
import { baseBody } from '#/features/branding-editor/services/themeBody';

export interface StylesheetValues extends Readonly<Record<string, unknown>> {
  stylesheet: string;
}

// An empty stylesheet is none: the page uses the layer below.
export function stylesheetValues(view: ThemeView): StylesheetValues {
  return { stylesheet: baseBody(view).stylesheet ?? '' };
}

export function stylesheetRequest(view: ThemeView, values: StylesheetValues): ThemeBodyRequest {
  return {
    ...baseBody(view),
    stylesheet: nullWhenBlank(values.stylesheet),
  };
}
