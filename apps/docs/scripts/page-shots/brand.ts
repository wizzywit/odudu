// A tenant's theme for the landing page's second look. It is a theme body as
// the admin API stores one, run through the server's own build and the real
// page renderers, so the picture shows what a published theme produces. The
// images are drawn here, byte for byte the same on every run, because a
// content hash names each of them in the page.
import { png, type Raster } from './png.ts';

export { png, storedZlib, type Raster } from './png.ts';
import {
  buildBranding,
  type BuildOutcome,
} from '../../../../packages/domain-theme/src/service/build-branding.ts';
import {
  assetPath,
  sha256Hex,
} from '../../../../packages/domain-theme/src/service/branding-urls.ts';
import type { ThemeBody } from '../../../../packages/domain-theme/src/service/body.ts';

export const BRAND_ORIGIN = 'http://pages.test';
export const BRAND_TENANT = 'acme';

const LOGO_ID = '0198f2a0-0000-7000-8000-0000000000a1';
const DARK_LOGO_ID = '0198f2a0-0000-7000-8000-0000000000a2';
const BACKGROUND_ID = '0198f2a0-0000-7000-8000-0000000000a3';

export const THEME_BODY: ThemeBody = {
  tokens: {
    font: 'IBM Plex Mono',
    light: {
      surfacePage: '#e9e8f6',
      surfacePanel: '#ffffff',
      surfaceSunken: '#f4f3fb',
      inkPrimary: '#2a1f6b',
      inkMuted: '#58528c',
      signalActive: '#e2defa',
      signalActiveInk: '#4b35c9',
      signalDanger: '#fae3d7',
      signalDangerInk: '#9c3a0e',
      borderStrong: '#7d78b8',
      focusRing: '#5b45e0',
    },
    dark: {
      surfacePage: '#17162a',
      surfacePanel: '#1f1d38',
      surfaceSunken: '#151429',
      inkPrimary: '#e6e3ff',
      inkMuted: '#a9a4d6',
      signalActive: '#2b2560',
      signalActiveInk: '#d4ccff',
      signalDanger: '#48220f',
      signalDangerInk: '#f59d73',
      borderStrong: '#7873b8',
      focusRing: '#9d8fff',
    },
  },
  stylesheet:
    // The cap matches Instrument's own mark height, so both looks share one frame.
    '.logo { max-block-size: 1.5625rem; }\nh1 { letter-spacing: 0.01em; }\nbutton { border-radius: var(--radius-m); }',
  templates: {},
  assets: {
    logo: { assetId: LOGO_ID, alt: 'Harbour' },
    darkLogo: { assetId: DARK_LOGO_ID, alt: 'Harbour' },
    background: { assetId: BACKGROUND_ID },
  },
};

type Rgb = [number, number, number];

const SAMPLES = 4;

// Each pixel is the mean of a grid of samples, so an edge is smooth.
function smooth(
  width: number,
  height: number,
  coverage: (x: number, y: number) => number,
): (x: number, y: number) => number {
  return (x, y) => {
    let sum = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      for (let j = 0; j < SAMPLES; j += 1) {
        sum += coverage((x + (i + 0.5) / SAMPLES) / width, (y + (j + 0.5) / SAMPLES) / height);
      }
    }
    return sum / (SAMPLES * SAMPLES);
  };
}

// A disc with a ring cut into it, in the tenant's two colours.
function logo(id: string, disc: Rgb, ring: Rgb): Raster {
  const size = 120;
  const inside = smooth(size, size, (u, v) => {
    const distance = Math.hypot(u - 0.5, v - 0.5);
    return distance <= 0.5 ? 1 : 0;
  });
  const band = smooth(size, size, (u, v) => {
    const distance = Math.hypot(u - 0.5, v - 0.5);
    return distance >= 0.22 && distance <= 0.32 ? 1 : 0;
  });
  return {
    id,
    width: size,
    height: size,
    pixel: (x, y) => {
      const alpha = inside(x, y);
      const mix = band(x, y);
      const colour = disc.map((channel, index) =>
        Math.round(channel * (1 - mix) + (ring[index] ?? 0) * mix),
      );
      return [colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0, Math.round(alpha * 255)];
    },
  };
}

// A soft diagonal wash of the tenant's purples behind the page.
function background(id: string): Raster {
  const width = 640;
  const height = 480;
  return {
    id,
    width,
    height,
    pixel: (x, y) => {
      const t = (x / width + y / height) / 2;
      const wave = 0.5 + 0.5 * Math.sin((x / width) * 6 + (y / height) * 3);
      const base: Rgb = [196, 190, 238];
      const tint: Rgb = [226, 222, 250];
      const mix = 0.35 * t + 0.4 * wave;
      const [r, g, b] = base.map((channel, index) =>
        Math.round(channel * (1 - mix) + (tint[index] ?? 0) * mix),
      );
      return [r ?? 0, g ?? 0, b ?? 0, 255];
    },
  };
}

interface BrandAsset {
  id: string;
  bytes: Buffer;
  sha256: string;
  mime: 'image/png';
  width: number;
  height: number;
}

function assets(): BrandAsset[] {
  return [
    logo(LOGO_ID, [75, 53, 201], [255, 255, 255]),
    logo(DARK_LOGO_ID, [169, 156, 255], [23, 22, 42]),
    background(BACKGROUND_ID),
  ].map((raster) => {
    const bytes = png(raster);
    return {
      id: raster.id,
      bytes,
      sha256: sha256Hex(bytes),
      mime: 'image/png' as const,
      width: raster.width,
      height: raster.height,
    };
  });
}

// What the server would resolve for a tenant that published THEME_BODY.
export function brandOutcome(): BuildOutcome {
  return buildBranding({
    tenantName: BRAND_TENANT,
    origin: BRAND_ORIGIN,
    layers: [
      {
        name: 'tenant',
        layer: {
          versionId: 'tenant-theme-version',
          clientId: null,
          version: 1,
          body: THEME_BODY,
          assets: assets().map(({ id, sha256, mime, width, height }) => ({
            id,
            sha256,
            mime,
            width,
            height,
          })),
        },
      },
    ],
  });
}

export interface BrandFile {
  body: Buffer | string;
  contentType: string;
}

// The files the brand route would answer, by path.
export function brandFiles(): Map<string, BrandFile> {
  const files = new Map<string, BrandFile>();
  for (const asset of assets()) {
    const route = assetPath(BRAND_TENANT, asset.sha256, asset.mime);
    if (route !== null) files.set(route, { body: asset.bytes, contentType: asset.mime });
  }
  const { branding, css } = brandOutcome();
  if (branding?.stylesheetUrl) {
    files.set(branding.stylesheetUrl, { body: css, contentType: 'text/css' });
  }
  return files;
}
