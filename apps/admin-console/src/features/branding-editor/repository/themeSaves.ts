import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { PutThemeRequest } from '@odudu/contracts/admin';
import { putTheme } from '#/features/branding-editor/adapter/themeDraft';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import {
  templateRequest,
  type TemplateValues,
} from '#/features/branding-editor/services/templateValues';
import {
  stylesheetRequest,
  type StylesheetValues,
} from '#/features/branding-editor/services/stylesheetValues';
import { imageRequest, type ImageValues } from '#/features/branding-editor/services/imageValues';
import { colourRequest, type ColourValues } from '#/features/branding-editor/services/colourValues';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import type { Values } from '#/shared/lib/services/dirty';
import type { Gateway } from '#/shared/api/transport/gateway';

// Each section saves the whole draft: its own part as edited, the rest as the
// record last held it.
function themeSave<V extends Values>(
  tenant: string,
  scope: ThemeScope,
  request: (values: V) => PutThemeRequest,
) {
  return (gateway: Gateway, { values, ifMatch }: SaveInput<V>) =>
    putTheme(gateway, tenant, scope, request(values), ifMatch);
}

export function colourSave(tenant: string, scope: ThemeScope, view: ThemeView) {
  return themeSave<ColourValues>(tenant, scope, (values) => colourRequest(view, values));
}

export function imageSave(tenant: string, scope: ThemeScope, view: ThemeView) {
  return themeSave<ImageValues>(tenant, scope, (values) => imageRequest(view, values));
}

export function templateSave(tenant: string, scope: ThemeScope, view: ThemeView) {
  return themeSave<TemplateValues>(tenant, scope, (values) => templateRequest(view, values));
}

export function stylesheetSave(tenant: string, scope: ThemeScope, view: ThemeView) {
  return themeSave<StylesheetValues>(tenant, scope, (values) => stylesheetRequest(view, values));
}
