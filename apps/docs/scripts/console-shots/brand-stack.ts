import type { Page } from '@playwright/test';
import { png, type Raster } from '../page-shots/brand.ts';

// The tenant and the client the Branding pictures are taken of. The tenant is
// deleted and made again for every pass, so each pass publishes its first
// version and the light and the dark pictures show the same numbers.
export const BRAND_TENANT = 'acme';
export const BRAND_CLIENT = 'storefront';

export interface ApiAnswer {
  readonly status: number;
  readonly etag: string | null;
  readonly body: unknown;
}

interface ApiInit {
  readonly json?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  // A binary body, as base64, with the type it is sent as.
  readonly bytes?: { readonly base64: string; readonly type: string };
}

// The console's own gateway, called the way the console calls it from the
// page: same origin, the session cookie, the subject header and the marker
// that a state change comes from the console.
export async function adminApi(
  page: Page,
  method: string,
  path: string,
  init: ApiInit = {},
): Promise<ApiAnswer> {
  return page.evaluate(
    async ({ method, path, init }) => {
      const session = (await (await fetch('/console/api/session')).json()) as {
        subject_id: string;
      };
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-odudu-console-subject': session.subject_id,
        ...(init.headers ?? {}),
      };
      if (method !== 'GET') headers['x-odudu-console'] = '1';
      let body: BodyInit | undefined;
      if (init.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(init.json);
      } else if (init.bytes !== undefined) {
        headers['content-type'] = init.bytes.type;
        body = Uint8Array.from(atob(init.bytes.base64), (char) => char.charCodeAt(0));
      }
      const response = await fetch(`/console/api/admin/${path}`, {
        method,
        headers,
        body,
        credentials: 'same-origin',
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        parsed = text;
      }
      return { status: response.status, etag: response.headers.get('etag'), body: parsed };
    },
    { method, path, init },
  );
}

async function onConsole(page: Page, base: string): Promise<void> {
  if (!page.url().startsWith(`${base}/console/`)) {
    await page.goto(`${base}/console/system/tenants`);
    await page.getByRole('heading', { level: 1 }).waitFor();
  }
}

function must(answer: ApiAnswer, what: string): ApiAnswer {
  if (answer.status >= 400) {
    throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
  }
  return answer;
}

export async function removeBrandTenant(page: Page, base: string): Promise<void> {
  await onConsole(page, base);
  const found = await adminApi(page, 'GET', `tenants/${BRAND_TENANT}`);
  if (found.status !== 200 || found.etag === null) return;
  const disabled = await adminApi(page, 'PATCH', `tenants/${BRAND_TENANT}`, {
    json: { enabled: false },
    headers: { 'if-match': found.etag },
  });
  must(disabled, 'disabling the branding tenant');
  must(
    await adminApi(page, 'DELETE', `tenants/${BRAND_TENANT}?confirm=${BRAND_TENANT}`),
    'deleting the branding tenant',
  );
}

// A tenant of its own, new, with one client to sign in to; returns the
// client's id as the admin API knows it.
export async function freshBrandTenant(page: Page, base: string): Promise<string> {
  await removeBrandTenant(page, base);
  must(
    await adminApi(page, 'POST', 'tenants', {
      json: { name: BRAND_TENANT, display_name: 'Acme' },
    }),
    'creating the branding tenant',
  );
  const client = must(
    await adminApi(page, 'POST', `tenants/${BRAND_TENANT}/clients`, {
      json: {
        client_id: BRAND_CLIENT,
        name: 'Storefront',
        redirect_uris: ['https://shop.example/callback'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'none',
      },
    }),
    'creating the branding client',
  );
  return (client.body as { id: string }).id;
}

export type ThemeTarget = 'tenant' | { readonly client: string };

function themePath(target: ThemeTarget): string {
  return target === 'tenant'
    ? `tenants/${BRAND_TENANT}/theme`
    : `tenants/${BRAND_TENANT}/clients/${target.client}/theme`;
}

type Json = Record<string, unknown>;

// Saves the draft as the draft read now with `change` laid over it, the way
// two administrators' saves meet at the server.
export async function saveDraft(page: Page, target: ThemeTarget, change: Json): Promise<void> {
  const current = must(await adminApi(page, 'GET', themePath(target)), 'reading the theme');
  const view = current.body as { draft: Json | null; published: { body: Json } | null };
  const base = view.draft ?? view.published?.body ?? {};
  const merged = { ...base, ...change };
  const headers: Record<string, string> = current.etag === null ? {} : { 'if-match': current.etag };
  must(await adminApi(page, 'PUT', themePath(target), { json: merged, headers }), 'saving a draft');
}

export async function publishDraft(page: Page, target: ThemeTarget): Promise<void> {
  const current = must(await adminApi(page, 'GET', themePath(target)), 'reading the theme');
  const headers: Record<string, string> = current.etag === null ? {} : { 'if-match': current.etag };
  must(await adminApi(page, 'POST', `${themePath(target)}/publish`, { headers }), 'publishing');
}

export async function uploadImage(
  page: Page,
  target: ThemeTarget,
  kind: 'logo' | 'darkLogo' | 'favicon' | 'background',
  png: Buffer,
): Promise<string> {
  const answer = must(
    await adminApi(page, 'POST', `${themePath(target)}/assets?kind=${kind}`, {
      bytes: { base64: png.toString('base64'), type: 'image/png' },
    }),
    `uploading the ${kind}`,
  );
  return (answer.body as { id: string }).id;
}

type Rgb = readonly [number, number, number];

const ACCENT: Rgb = [184, 70, 26];

function raster(
  id: string,
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgb,
): Raster {
  return {
    id,
    width,
    height,
    pixel: (x, y) => {
      const [red, green, blue] = paint(x, y);
      return [red, green, blue, 255];
    },
  };
}

// A wordless mark: an orange disc with a pale ring, on the colour of the
// page it is shown on.
export function logoPng(ground: Rgb): Buffer {
  return png(
    raster('logo', 96, 96, (x, y) => {
      const distance = Math.hypot(x - 48, y - 48);
      if (distance < 22) return ACCENT;
      if (distance < 30) return [251, 238, 226];
      if (distance < 40) return ACCENT;
      return ground;
    }),
  );
}

// Soft diagonal bands of two warm tones, small enough to be stored as drawn
// and still within the background's size limit once it is.
export function backgroundPng(): Buffer {
  return png(
    raster('background', 320, 200, (x, y) =>
      Math.floor((x + y) / 40) % 2 === 0 ? [244, 226, 208] : [250, 238, 224],
    ),
  );
}

export const LOGO_LIGHT: Buffer = logoPng([255, 250, 245]);
export const LOGO_DARK: Buffer = logoPng([43, 26, 18]);
