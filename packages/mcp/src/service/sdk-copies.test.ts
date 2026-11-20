import {
  addressIssuer as sdkIssuer,
  domainAddress as sdkDomain,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  pathAddress as sdkPath,
  stripBidiControls as sdkStrip,
} from '@odudu-io/mcp-stdio/shared';
import { stripBidiControls } from '@odudu/contracts';
import { addressIssuer, domainAddress, pathAddress } from '@odudu/kernel';
import { MCP_READ_SCOPE as READ, MCP_WRITE_SCOPE as WRITE } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';

// The stdio client may import no server package, so a few small pure pieces are
// written twice. Each is held here to what the server's own says.

describe('what the stdio client holds a copy of', () => {
  it('addresses a tenant as the kernel does', () => {
    for (const [base, tenant] of [
      ['https://id.example.com', 'acme'],
      ['https://id.example.com///', 'a b/c'],
      ['http://localhost:3000', 'x'],
    ] as const) {
      expect(sdkPath(base, tenant)).toEqual(pathAddress(base, tenant));
      expect(sdkIssuer(sdkPath(base, tenant))).toBe(addressIssuer(pathAddress(base, tenant)));
    }
    for (const tls of [true, false]) {
      expect(sdkDomain('login.acme.test', tls)).toEqual(domainAddress('login.acme.test', tls));
      expect(sdkIssuer(sdkDomain('login.acme.test', tls))).toBe(
        addressIssuer(domainAddress('login.acme.test', tls)),
      );
    }
  });

  it('strips the bidirectional controls as the contracts do', () => {
    const everything = Array.from({ length: 0x2100 - 0x2000 }, (_, i) =>
      String.fromCodePoint(0x2000 + i),
    ).join('');
    for (const text of [everything, 'a‮b⁦c⁩', 'plain', 'س‏ل']) {
      expect(sdkStrip(text)).toBe(stripBidiControls(text));
    }
  });

  it('names the two scopes as the OIDC package does', () => {
    expect(MCP_READ_SCOPE).toBe(READ);
    expect(MCP_WRITE_SCOPE).toBe(WRITE);
  });
});
