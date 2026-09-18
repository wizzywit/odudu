import { isIPv4, isIPv6 } from 'node:net';

export class RemoteAddressRefused extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'RemoteAddressRefused';
    this.reason = reason;
  }
}

// Shape only: scheme and credentials, checked before any DNS lookup. A
// client's registration must not depend on its key host being reachable at
// that moment, or on DNS still answering the same way later — see ADR 0028.
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteAddressRefused(`scheme must be https: ${raw} does not parse as a URL`);
  }
  if (url.protocol !== 'https:') {
    throw new RemoteAddressRefused(`scheme must be https, not ${url.protocol.replace(':', '')}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new RemoteAddressRefused('URL must not carry embedded credentials');
  }
  return url;
}

interface Options {
  readonly allowPrivate?: boolean;
}

// Resolved addresses only, checked immediately before connecting — never a
// hostname, which a second DNS lookup inside the HTTP client could resolve
// differently (DNS rebinding). See ADR 0028.
export function assertPublicAddresses(addresses: readonly string[], options: Options = {}): void {
  for (const address of addresses) {
    assertPublicAddress(address, options);
  }
}

function assertPublicAddress(address: string, options: Options): void {
  if (isIPv4(address)) {
    assertPublicIPv4(address, options, address);
    return;
  }
  if (isIPv6(address)) {
    const mapped = asIPv4Mapped(address);
    if (mapped !== null) {
      assertPublicIPv4(mapped, options, address);
      return;
    }
    assertPublicIPv6(address, options);
    return;
  }
  throw new RemoteAddressRefused(`address ${address} is neither a valid IPv4 nor IPv6 address`);
}

function asIPv4Mapped(address: string): string | null {
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/iu.exec(address);
  const v4 = match?.[1];
  return v4 !== undefined && isIPv4(v4) ? v4 : null;
}

function ipv4Octets(address: string): readonly [number, number, number, number] {
  const parts = address.split('.').map(Number);
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new RemoteAddressRefused(`address ${address} is not a valid IPv4 address`);
  }
  return [a, b, c, d];
}

function assertPublicIPv4(address: string, options: Options, reported: string): void {
  const [a, b] = ipv4Octets(address);

  if (a === 127) {
    throw new RemoteAddressRefused(`address ${reported} is a loopback address`);
  }
  if (a === 0) {
    throw new RemoteAddressRefused(`address ${reported} is an unspecified address`);
  }
  if (a === 169 && b === 254) {
    throw new RemoteAddressRefused(`address ${reported} is a link-local address`);
  }
  if (a >= 224 && a <= 239) {
    throw new RemoteAddressRefused(`address ${reported} is a multicast address`);
  }
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (isPrivate && options.allowPrivate !== true) {
    throw new RemoteAddressRefused(`address ${reported} is a private address`);
  }
}

function ipv6Hextets(address: string): readonly number[] {
  const withoutZone = address.split('%')[0] ?? address;
  const halves = withoutZone.split('::');
  if (halves.length > 2) {
    throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
  }

  const parseGroup = (group: string): number[] =>
    group === '' ? [] : group.split(':').map((hextet) => parseInt(hextet, 16));

  const head = parseGroup(halves[0] ?? '');
  if (halves.length === 1) return head;

  const tail = parseGroup(halves[1] ?? '');
  const missing = 8 - head.length - tail.length;
  return [...head, ...new Array<number>(Math.max(missing, 0)).fill(0), ...tail];
}

function assertPublicIPv6(address: string, options: Options): void {
  const hextets = ipv6Hextets(address);
  const first = hextets[0];
  if (first === undefined) {
    throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
  }

  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isMulticast = (first & 0xff00) === 0xff00;

  if (isUnspecified) {
    throw new RemoteAddressRefused(`address ${address} is an unspecified address`);
  }
  if (isLoopback) {
    throw new RemoteAddressRefused(`address ${address} is a loopback address`);
  }
  if (isLinkLocal) {
    throw new RemoteAddressRefused(`address ${address} is a link-local address`);
  }
  if (isMulticast) {
    throw new RemoteAddressRefused(`address ${address} is a multicast address`);
  }
  if (isUniqueLocal && options.allowPrivate !== true) {
    throw new RemoteAddressRefused(`address ${address} is a unique local address`);
  }
}
