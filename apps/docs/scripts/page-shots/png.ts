// A PNG written by hand from a function of the pixel, byte for byte the same on every run.
import { crc32 } from 'node:zlib';

export interface Raster {
  id: string;
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number, number];
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const MAX_STORED = 65535;

// A zlib stream of stored blocks written by hand: zlib's own level 0 splits
// blocks at its output chunk size, which a Node release may change, and the
// bytes are hashed into the asset URLs the page carries.
export function storedZlib(data: Buffer): Buffer {
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  let offset = 0;
  do {
    const block = data.subarray(offset, offset + MAX_STORED);
    offset += block.length;
    const head = Buffer.alloc(5);
    head[0] = offset >= data.length ? 1 : 0;
    head.writeUInt16LE(block.length, 1);
    head.writeUInt16LE(~block.length & 0xffff, 3);
    parts.push(head, block);
  } while (offset < data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(data), 0);
  return Buffer.concat([...parts, tail]);
}

export function png(raster: Raster): Buffer {
  const { width, height } = raster;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      rows.set(raster.pixel(x, y), offset + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', storedZlib(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
