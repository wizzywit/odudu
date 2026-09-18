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
    throw new RemoteAddressRefused(`${raw} does not parse as a URL`);
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
    assertPublicIPv6(address, options);
    return;
  }
  throw new RemoteAddressRefused(`address ${address} is neither a valid IPv4 nor IPv6 address`);
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
  const [a, b, c, d] = ipv4Octets(address);

  if (a === 127) {
    throw new RemoteAddressRefused(`address ${reported} is a loopback address`);
  }
  if (a === 0) {
    throw new RemoteAddressRefused(`address ${reported} is an unspecified address`);
  }
  if (a === 169 && b === 254) {
    throw new RemoteAddressRefused(`address ${reported} is a link-local address`);
  }
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    throw new RemoteAddressRefused(`address ${reported} is the broadcast address`);
  }
  // 240.0.0.0/4 (class E, reserved) already includes 255.255.255.255, but
  // that one gets its own message above rather than the generic one below.
  if (a >= 240) {
    throw new RemoteAddressRefused(`address ${reported} is a reserved address (240.0.0.0/4)`);
  }
  if (a >= 224 && a <= 239) {
    throw new RemoteAddressRefused(`address ${reported} is a multicast address`);
  }
  if (a === 192 && b === 0 && c === 0) {
    throw new RemoteAddressRefused(
      `address ${reported} is an IETF protocol assignment address (192.0.0.0/24)`,
    );
  }
  if (a === 100 && b >= 64 && b <= 127) {
    throw new RemoteAddressRefused(
      `address ${reported} is a carrier-grade NAT address (100.64.0.0/10)`,
    );
  }

  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (isPrivate && options.allowPrivate !== true) {
    throw new RemoteAddressRefused(`address ${reported} is a private address`);
  }
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/iu;

// A parse failure here must throw — never fall through to a bitmask
// comparison against `NaN`, which always reads false and so admits the
// address it was meant to refuse.
function parseIPv6Half(address: string, half: string): number[] {
  if (half === '') return [];
  const groups = half.split(':');
  const hextets: number[] = [];
  groups.forEach((group, index) => {
    if (group.includes('.')) {
      if (index !== groups.length - 1 || !isIPv4(group)) {
        throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
      }
      const [a, b, c, d] = ipv4Octets(group);
      hextets.push((a << 8) | b, (c << 8) | d);
      return;
    }
    if (!HEX_GROUP.test(group)) {
      throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
    }
    hextets.push(parseInt(group, 16));
  });
  return hextets;
}

function ipv6Hextets(address: string): readonly number[] {
  const withoutZone = address.split('%')[0] ?? address;
  const halves = withoutZone.split('::');

  if (halves.length === 1) {
    const hextets = parseIPv6Half(address, halves[0] ?? '');
    if (hextets.length !== 8) {
      throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
    }
    return hextets;
  }
  if (halves.length !== 2) {
    throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
  }

  const head = parseIPv6Half(address, halves[0] ?? '');
  const tail = parseIPv6Half(address, halves[1] ?? '');
  const missing = 8 - head.length - tail.length;
  // "::" stands for one or more groups of zero; a compression that leaves
  // nothing to fill (or too little room) is not a valid address.
  if (missing < 1) {
    throw new RemoteAddressRefused(`address ${address} is not a valid IPv6 address`);
  }
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

// The two IPv4-in-IPv6 forms this server must not be fooled by: the
// mapped/compatible `::ffff:a.b.c.d` and `::a.b.c.d` families (any
// spelling — dotted or hex, compressed or not) and the NAT64 well-known
// prefix `64:ff9b::/96` (RFC 6052). Both carry the real address in the
// last 32 bits; every other bit pattern is checked as ordinary IPv6.
function embeddedIPv4(hextets: readonly number[]): string | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
  const isMappedOrCompatible =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0 || h5 === 0xffff);
  const isNat64WellKnown =
    h0 === 0x0064 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
  if (!isMappedOrCompatible && !isNat64WellKnown) return null;

  const high = h6 ?? 0;
  const low = h7 ?? 0;
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
}

function assertPublicIPv6(address: string, options: Options): void {
  const hextets = ipv6Hextets(address);

  const embedded = embeddedIPv4(hextets);
  if (embedded !== null) {
    assertPublicIPv4(embedded, options, address);
    return;
  }

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
