import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageInspector,
  inspectImage,
  decodeImage,
  isImageRefusal,
  MAX_DECODED_PIXELS,
  type ImageRefusal,
  type InspectedImage,
} from '#/service/image';

const WIDE = { maxPixels: MAX_DECODED_PIXELS, maxSide: 100_000 };

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } });
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

// A valid header that declares more than its data holds.
function pngDeclaring(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.alloc(8)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function accepted(result: InspectedImage | ImageRefusal): InspectedImage {
  if (isImageRefusal(result)) throw new Error(`refused: ${result.code}`);
  return result;
}

function refusedWith(result: InspectedImage | ImageRefusal): string {
  return isImageRefusal(result) ? result.code : 'accepted';
}

describe('[ODUDU-THEME-UPLOAD-01] inspectImage', () => {
  it('accepts a polyglot PNG with HTML appended only after re-encoding, and the output has no trailer', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const polyglot = Buffer.concat([png, Buffer.from('<html><script>alert(1)</script></html>')]);
    const out = accepted(await inspectImage(polyglot));
    expect(Buffer.from(out.bytes).includes('<script>')).toBe(false);
    expect(Buffer.from(out.bytes).subarray(-12).toString('latin1')).toContain('IEND');
    expect(out.mime).toBe('image/png');
  });

  it('refuses EXIF-bearing JPEG metadata in the output', async () => {
    const jpeg = await solid(8, 8)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SECRETCOPY', Make: 'SECRETMAKE' } })
      .toBuffer();
    expect(jpeg.includes('SECRETCOPY')).toBe(true);
    const out = accepted(await inspectImage(jpeg));
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(Buffer.from(out.bytes).includes('SECRET')).toBe(false);
  });

  it('strips text chunks from a PNG', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const at = png.indexOf('IDAT') - 4;
    const tagged = Buffer.concat([
      png.subarray(0, at),
      chunk('tEXt', Buffer.from('Comment\0<script>x</script>')),
      png.subarray(at),
    ]);
    const out = accepted(await inspectImage(tagged));
    expect(Buffer.from(out.bytes).includes('<script>')).toBe(false);
  });

  it('applies the EXIF orientation, then drops the tag', async () => {
    const jpeg = await solid(64, 48).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    const out = accepted(await inspectImage(jpeg));
    expect([out.width, out.height]).toEqual([48, 64]);
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height, meta.orientation]).toEqual([48, 64, undefined]);
  });

  it('refuses an animated WebP', async () => {
    const frames = await Promise.all(
      ['red', 'green', 'blue'].map((background) =>
        sharp({ create: { width: 16, height: 16, channels: 3, background } })
          .png()
          .toBuffer(),
      ),
    );
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(3);
    expect(refusedWith(await inspectImage(animated))).toBe('animated');
  });

  it('refuses an APNG', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const at = png.indexOf('IDAT') - 4;
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    const apng = Buffer.concat([png.subarray(0, at), chunk('acTL', actl), png.subarray(at)]);
    expect(refusedWith(await inspectImage(apng))).toBe('animated');
  });

  it('refuses a decompression bomb by declared pixels before decoding', async () => {
    const bomb = pngDeclaring(30_000, 30_000);
    expect(bomb.length).toBeLessThan(200);
    // Decoding this file fails as corrupt; a pixel refusal means only the
    // header was read.
    expect(refusedWith(await inspectImage(bomb, WIDE))).toBe('too_many_pixels');
    expect(refusedWith(await inspectImage(bomb))).toBe('too_many_pixels');
  });

  it('refuses a JPEG whose header declares a huge size', async () => {
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    const forged = Buffer.from(jpeg);
    forged.writeUInt16BE(30_000, sof + 5);
    forged.writeUInt16BE(30_000, sof + 7);
    expect(refusedWith(await inspectImage(forged, WIDE))).toBe('too_many_pixels');
  });

  it('detects type by bytes and ignores the declared content-type', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const jpeg = await solid(8, 8).jpeg().toBuffer();
    expect(accepted(await inspectImage(png)).mime).toBe('image/png');
    expect(accepted(await inspectImage(jpeg)).mime).toBe('image/jpeg');
    const webp = await solid(8, 8).webp().toBuffer();
    expect(accepted(await inspectImage(webp)).mime).toBe('image/webp');
  });

  it('refuses SVG, GIF, TIFF, HTML, text and an empty body', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    const gif = await solid(8, 8).gif().toBuffer();
    const tiff = await solid(8, 8).tiff().toBuffer();
    for (const bytes of [
      svg,
      gif,
      tiff,
      Buffer.from('<html></html>'),
      Buffer.from('hi'),
      Buffer.alloc(0),
    ]) {
      expect(refusedWith(await inspectImage(bytes))).toBe('unsupported_type');
    }
  });

  it('refuses a truncated PNG and a PNG with a corrupt body', async () => {
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: 'black',
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .png()
      .toBuffer();
    expect(refusedWith(await inspectImage(png.subarray(0, png.length - 40)))).toBe('corrupt');
    expect(refusedWith(await inspectImage(png.subarray(0, 40)))).toBe('corrupt');
    expect(refusedWith(await inspectImage(png.subarray(0, 8)))).toBe('corrupt');
  });

  it('refuses a zero-dimension PNG', async () => {
    expect(refusedWith(await inspectImage(pngDeclaring(0, 8)))).not.toBe('accepted');
    expect(refusedWith(await inspectImage(pngDeclaring(8, 0)))).not.toBe('accepted');
  });

  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('accepts a 1x1 %s', async (format, mime) => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } })
      .toFormat(format)
      .toBuffer();
    const out = accepted(await inspectImage(bytes));
    expect([out.mime, out.width, out.height]).toEqual([mime, 1, 1]);
  });

  it('accepts 16 million pixels and refuses one pair of pixels more', async () => {
    const under = await solid(4000, 4000).png().toBuffer();
    expect(accepted(await inspectImage(under, WIDE)).width).toBe(4000);
    const over = await solid(8_000_001, 2).png().toBuffer();
    expect(refusedWith(await inspectImage(over, WIDE))).toBe('too_many_pixels');
  }, 60_000);

  it('refuses a side past the limit it is given', async () => {
    const wide = await solid(300, 10).png().toBuffer();
    expect(refusedWith(await inspectImage(wide, { maxPixels: 1_000_000, maxSide: 256 }))).toBe(
      'too_wide',
    );
  });

  it('keeps a bounded number of decodes running and refuses past its queue', async () => {
    const png = await solid(8, 8).png().toBuffer();
    const inspector = createImageInspector(1, 2);
    const results = await Promise.all(Array.from({ length: 6 }, () => inspector(png)));
    const codes = results.map(refusedWith);
    expect(codes.filter((code) => code === 'accepted')).toHaveLength(3);
    expect(codes.filter((code) => code === 'busy')).toHaveLength(3);
    expect(refusedWith(await inspector(png))).toBe('accepted');
  });

  it('never has more decodes in flight than its limit, and frees a slot after one throws', async () => {
    const png = await solid(8, 8).png().toBuffer();
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const inspector = createImageInspector(2, 50, {
      run: async (bytes, limits) => {
        calls += 1;
        const mine = calls;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (mine === 1) throw new Error('decoder fault');
          return await decodeImage(bytes, limits);
        } finally {
          inFlight -= 1;
        }
      },
    });
    const all = Promise.all(Array.from({ length: 20 }, () => inspector(png)));
    // A slot that is never freed leaves the queued calls waiting for ever;
    // the race turns that into a failure.
    let guard: ReturnType<typeof setTimeout> | undefined;
    const results = await Promise.race([
      all,
      new Promise<never>((_, reject) => {
        guard = setTimeout(() => {
          reject(new Error('queued decodes never ran: a slot was not freed'));
        }, 3000);
      }),
    ]).finally(() => {
      clearTimeout(guard);
    });
    expect(peak).toBe(2);
    expect(results.map(refusedWith).filter((code) => code === 'corrupt')).toHaveLength(1);
    expect(results.map(refusedWith).filter((code) => code === 'accepted')).toHaveLength(19);
  }, 10_000);

  it('refuses a decode that never finishes and frees its slot', async () => {
    vi.useFakeTimers();
    try {
      const png = await solid(8, 8).png().toBuffer();
      let calls = 0;
      const inspector = createImageInspector(1, 4, {
        timeoutMs: 1000,
        run: (bytes, limits) => {
          calls += 1;
          return calls === 1 ? new Promise(() => undefined) : decodeImage(bytes, limits);
        },
      });
      const stuck = inspector(png);
      const next = inspector(png);
      await vi.advanceTimersByTimeAsync(1000);
      expect(refusedWith(await stuck)).toBe('timeout');
      await vi.advanceTimersByTimeAsync(0);
      expect(refusedWith(await next)).toBe('accepted');
    } finally {
      vi.useRealTimers();
    }
  });
});
