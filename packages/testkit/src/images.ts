import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngOptions {
  width?: number;
  height?: number;
  // The colour of every pixel; two pictures with different colours are two
  // different files.
  rgb?: readonly [number, number, number];
  // A chunk written before the image data, such as `acTL`, which makes a PNG
  // an animated one.
  before?: { type: string; data: Buffer };
}

// A valid, uncompressed-to-a-flat-colour 8-bit RGB PNG, built without an
// image library so a test can feed one to code that decodes with one.
export function makePng({
  width = 8,
  height = 8,
  rgb = [200, 30, 30],
  before,
}: PngOptions = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...(before === undefined ? [] : [chunk(before.type, before.data)]),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A PNG that declares two frames.
export function makeApng(): Buffer {
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  return makePng({ before: { type: 'acTL', data: actl } });
}
