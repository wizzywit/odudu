import type { PutThemeRequest, ThemeView } from '@odudu/contracts/admin';
import { putTheme } from '#/features/branding/adapter/theme';
import { type ThemeScope } from '#/features/branding/services/scope';
import {
  colourRequest,
  imageRequest,
  stylesheetRequest,
  templateRequest,
  type ColourValues,
  type ImageValues,
  type StylesheetValues,
  type TemplateValues,
} from '#/features/branding/services/values';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Values } from '#/shared/services/dirty';
import type { Gateway } from '#/shared/transport/gateway';

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
