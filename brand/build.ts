import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { FAVICON_INSET, TOUCH_INSET, insetTransform } from './geometry.ts';

// Exports the PNG and ICO derivatives from the SVGs in this directory with the
// Chromium that the documentation's browser tests already install.
// Run from the repository root: node brand/build.ts

const ROOT = path.resolve(import.meta.dirname, '..');
const BRAND = import.meta.dirname;
const PREVIEWS = path.join(ROOT, 'docs/phases/p4g-docs');

interface Page {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: {
    type: 'png';
    omitBackground?: boolean;
    fullPage?: boolean;
  }): Promise<Buffer>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

function isPlaywright(value: unknown): value is Playwright {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'chromium' in value
  );
}

// Instrument surfaces and inks, from apps/admin-console/src/shared/ui/tokens.css.
const THEMES = {
  light: { surface: '#e7eae9', ink: '#161b1a' },
  dark: { surface: '#151a19', ink: '#e4e9e7' },
} as const;

function svg(file: string): string {
  return readFileSync(path.join(BRAND, file), 'utf8');
}

function sized(markup: string, width: number, height: number): string {
  return markup.replace(
    / width="\d+" height="\d+"/u,
    ` width="${String(width)}" height="${String(height)}"`,
  );
}

function write(directory: string, file: string, content: Buffer): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, file), content);
}

type Render = (
  markup: string,
  width: number,
  height: number,
  surface: string,
  ink: string,
) => Promise<Buffer>;

const ICO_SIZES = [16, 32, 48] as const;

// Every derivative that is committed beside the SVGs it comes from.
async function brandOutputs(render: Render): Promise<Map<string, Buffer>> {
  const favicon = svg('favicon.svg');
  const touch = favicon
    .replace('rx="6"', 'rx="0"')
    .replace(insetTransform(FAVICON_INSET), insetTransform(TOUCH_INSET));
  const out = new Map<string, Buffer>();
  const icons = await Promise.all(
    ICO_SIZES.map((size) => render(favicon, size, size, 'transparent', 'black')),
  );
  out.set('favicon.ico', packIco(ICO_SIZES, icons));
  out.set('apple-touch-icon.png', await render(touch, 180, 180, 'transparent', 'black'));
  out.set('icon-192.png', await render(touch, 192, 192, 'transparent', 'black'));
  out.set('icon-512.png', await render(touch, 512, 512, 'transparent', 'black'));
  out.set('social.png', await render(svg('social.svg'), 1200, 630, 'transparent', 'black'));
  return out;
}

async function main(): Promise<void> {
  const required: unknown = createRequire(path.join(ROOT, 'apps/docs/package.json'))(
    '@playwright/test',
  );
  if (!isPlaywright(required)) throw new Error('@playwright/test has no chromium');
  const browser = await required.chromium.launch();
  const page = await browser.newPage();

  const render: Render = async (markup, width, height, surface, ink) => {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<!doctype html><body style="margin:0;background:${surface};color:${ink};line-height:0">${sized(markup, width, height)}</body>`,
    );
    return page.screenshot({ type: 'png', omitBackground: surface === 'transparent' });
  };

  try {
    const outputs = await brandOutputs(render);
    if (process.argv.includes('--check')) {
      await checkOutputs(page, outputs);
      return;
    }
    for (const [file, content] of outputs) write(BRAND, file, content);

    const favicon = svg('favicon.svg');
    const mark = svg('mark.svg');
    const lockup = svg('lockup.svg');
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const size of [16, 24, 32, 180]) {
        write(
          PREVIEWS,
          `brand-mark-${String(size)}-${name}.png`,
          await render(mark, size, size, theme.surface, theme.ink),
        );
      }
      write(
        PREVIEWS,
        `brand-lockup-${name}.png`,
        await render(lockup, 440, 128, theme.surface, theme.ink),
      );
    }
    for (const size of [16, 32]) {
      write(
        PREVIEWS,
        `brand-favicon-${String(size)}.png`,
        await render(favicon, size, size, '#ffffff', 'black'),
      );
    }
    write(PREVIEWS, 'brand-candidates.png', await renderCandidates(page, mark));
    write(PREVIEWS, 'brand-social.png', readFileSync(path.join(BRAND, 'social.png')));
    write(PREVIEWS, 'brand-mail-mark.png', await render(favicon, 80, 80, '#ffffff', 'black'));
  } finally {
    await browser.close();
  }
}

// Chromium's rasteriser is not promised to be byte-identical across machines,
// so a derivative counts as reproduced when no more than 0.5% of its pixels
// differ by more than 12 in any channel and none by more than 64.
const MAX_CHANNEL = 64;
const NOTICEABLE = 12;
const MAX_NOTICEABLE_SHARE = 0.005;

function embeddedPngs(ico: Buffer): Buffer[] {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const start = ico.readUInt32LE(entry + 12);
    return ico.subarray(start, start + ico.readUInt32LE(entry + 8));
  });
}

async function difference(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ max: number; share: number }> {
  const result = await page.evaluate(`(async () => {
    const load = (b64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = 'data:image/png;base64,' + b64;
    });
    const [first, second] = await Promise.all([load('${a.toString('base64')}'), load('${b.toString('base64')}')]);
    if (first.width !== second.width || first.height !== second.height) return { max: 255, share: 1 };
    const read = (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const x = read(first);
    const y = read(second);
    let max = 0;
    let noticeable = 0;
    for (let i = 0; i < x.length; i += 4) {
      let worst = 0;
      for (let c = 0; c < 4; c += 1) worst = Math.max(worst, Math.abs(x[i + c] - y[i + c]));
      max = Math.max(max, worst);
      if (worst > ${String(NOTICEABLE)}) noticeable += 1;
    }
    return { max, share: noticeable / (x.length / 4) };
  })()`);
  if (
    typeof result === 'object' &&
    result !== null &&
    'max' in result &&
    'share' in result &&
    typeof result.max === 'number' &&
    typeof result.share === 'number'
  ) {
    return { max: result.max, share: result.share };
  }
  throw new Error('the page returned no difference');
}

async function checkOutputs(page: Page, outputs: Map<string, Buffer>): Promise<void> {
  const failures: string[] = [];
  for (const [file, rebuilt] of outputs) {
    const committed = readFileSync(path.join(BRAND, file));
    const pairs = file.endsWith('.ico')
      ? embeddedPngs(rebuilt).map((png, index) => [png, embeddedPngs(committed)[index]] as const)
      : [[rebuilt, committed] as const];
    for (const [fresh, kept] of pairs) {
      if (kept === undefined) {
        failures.push(`${file}: an image is missing`);
        continue;
      }
      const { max, share } = await difference(page, fresh, kept);
      if (max > MAX_CHANNEL || share > MAX_NOTICEABLE_SHARE) {
        failures.push(`${file}: max ${String(max)}, ${(share * 100).toFixed(2)}% of pixels differ`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `brand derivatives are stale, run node brand/build.ts:\n${failures.join('\n')}`,
    );
  }
  process.stdout.write(`brand derivatives reproduced: ${String(outputs.size)} files\n`);
}

// The record of the crossbar choice: at y=20 and y=25 the figure reads as the
// sign for Venus, at y=14 as a sceptre.
const CANDIDATES = [
  { label: 'A  bar y=20 (reads as Venus)', bar: 'M12 20H20' },
  { label: 'B  bar y=14 (collar, chosen)', bar: 'M12 14H20' },
  { label: 'C  bar y=25 (low grip, reads as Venus)', bar: 'M12 25H20' },
] as const;
const CANDIDATE_SIZES = [16, 24, 32, 64, 180] as const;

async function renderCandidates(page: Page, mark: string): Promise<Buffer> {
  const panel = (theme: (typeof THEMES)[keyof typeof THEMES], bar: string): string =>
    `<div style="background:${theme.surface};color:${theme.ink};padding:16px;display:flex;gap:20px;align-items:flex-end">${CANDIDATE_SIZES.map(
      (size) => sized(mark.replace('M12 14H20', bar), size, size),
    ).join('')}</div>`;
  const rows = CANDIDATES.map(
    ({ label, bar }) =>
      `<div style="font:14px monospace;color:#161b1a;margin:12px 0 4px">${label}</div><div style="display:flex;gap:8px">${panel(THEMES.light, bar)}${panel(THEMES.dark, bar)}</div>`,
  ).join('');
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.setContent(
    `<!doctype html><body style="margin:16px;background:#fff;line-height:0">${rows}</body>`,
  );
  return page.screenshot({ type: 'png', fullPage: true });
}

// An ICO whose images are PNGs, which every current browser reads.
function packIco(sizes: readonly number[], images: readonly Buffer[]): Buffer {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const image = images[index] ?? Buffer.alloc(0);
    const entry = 6 + index * 16;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

await main();
