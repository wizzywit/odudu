import type { ThemeBodyRequest } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import { baseBody } from '#/features/branding/services/values';

export type ImageSlot = 'logo' | 'darkLogo' | 'favicon' | 'background';

export const IMAGE_SLOTS: readonly ImageSlot[] = ['logo', 'darkLogo', 'favicon', 'background'];

export interface Logo {
  assetId: string;
  alt: string;
}

export interface Plain {
  assetId: string;
}

export interface ImageValues extends Readonly<Record<string, unknown>> {
  'assets.logo': Logo | null;
  'assets.darkLogo': Logo | null;
  'assets.favicon': Plain | null;
  'assets.background': Plain | null;
}

export type ImageField = `assets.${ImageSlot}`;

export function imageField(slot: ImageSlot): ImageField {
  return `assets.${slot}`;
}

export function imageValues(view: ThemeView): ImageValues {
  const { assets } = baseBody(view);
  return {
    'assets.logo': assets.logo ?? null,
    'assets.darkLogo': assets.darkLogo ?? null,
    'assets.favicon': assets.favicon ?? null,
    'assets.background': assets.background ?? null,
  };
}

function assetsOf(values: ImageValues): ThemeBodyRequest['assets'] {
  return {
    ...(values['assets.logo'] === null ? {} : { logo: values['assets.logo'] }),
    ...(values['assets.darkLogo'] === null ? {} : { darkLogo: values['assets.darkLogo'] }),
    ...(values['assets.favicon'] === null ? {} : { favicon: values['assets.favicon'] }),
    ...(values['assets.background'] === null ? {} : { background: values['assets.background'] }),
  };
}

export function imageRequest(view: ThemeView, values: ImageValues): ThemeBodyRequest {
  return { ...baseBody(view), assets: assetsOf(values) };
}
