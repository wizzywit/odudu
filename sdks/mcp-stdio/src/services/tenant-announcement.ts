// What a connection says about the tenant it serves, so a client with several
// Odudu servers connected can tell them apart from the server's own words.
// The tenant is the validated token's on HTTP and `--tenant` on stdio, never a
// tool's input; its name is data, so it is cut down to the characters a
// tenant name is made of before it is put in any sentence.
export const TENANT_LABEL_CAP = 64;

const SERVER_NAME = 'odudu';
const OUTSIDE_LABEL = /[^\p{L}\p{N}._-]/gu;

export interface TenantAnnouncement {
  // `serverInfo.name`, `serverInfo.title` and the initialize result's `instructions`.
  readonly name: string;
  readonly title: string;
  readonly instructions: string;
  // A tool's description as listed for this tenant.
  describe(description: string): string;
}

export function announceTenant(tenant: string): TenantAnnouncement {
  const label = tenant.replace(OUTSIDE_LABEL, '_').slice(0, TENANT_LABEL_CAP) || '_';
  return {
    name: `${SERVER_NAME}:${label}`,
    title: `Odudu (${label})`,
    instructions:
      `This server acts in the Odudu tenant "${label}" only, as the person signed in; every tool ` +
      'works on that tenant. If you also have other Odudu servers connected, check the tenant ' +
      'before using a tool.',
    describe: (description) => `[${label}] ${description}`,
  };
}
