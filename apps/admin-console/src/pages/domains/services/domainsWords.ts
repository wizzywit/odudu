import { areaTitled, type Area } from '#/entities/area';

export const DOMAINS_RECORD = 'domains';

export const DOMAINS_WORDS = {
  description:
    'The addresses this tenant can sign in at, and the one it uses now. A tenant signs in at its path address until one of its domains is made the address.',
  lastAction: 'Last domain action',
  register: {
    title: 'Register a domain',
    rule: 'Register a host you control, publish the TXT record Odudu gives you for it, then verify it. Only a verified domain can become the tenant’s address. A pending domain that is never verified is removed after a few days.',
    hostLabel: 'Host',
    hostDescription: 'A lowercase name such as login.acme.com, without a scheme, path or port.',
    submit: 'Register domain',
    registering: 'Registering…',
    last: 'Last registration',
  },
  list: {
    title: 'Domains',
    label: 'Domains',
    loading: 'Loading the domains',
    failed: 'The domains could not be loaded',
    nothingYet:
      'No domain is registered. Register a host above to give this tenant an address of its own.',
    columns: {
      host: 'Host',
      state: 'State',
      use: 'Use',
      checked: 'Last checked',
      actions: 'Actions',
    },
    verify: 'Verify',
    activate: 'Make the address',
    deactivate: 'Switch back',
    remove: 'Remove',
  },
  challenge: {
    title: 'Publish this record',
    rule: 'Add a TXT record with this name and value at the DNS provider of the host, then choose Verify on its row. It can take a while for DNS to show it.',
    name: 'Name',
    value: 'Value',
    lastVerify: 'Last verification',
  },
  switching: {
    title: 'Switching the address',
    sessions:
      'A switch signs everyone in at the tenant out, because a session belongs to the address it began at, and moves the issuer, the sign-in pages and the links in mail.',
    passkeys:
      'Passkeys belong to the address they were registered at, so a switch hides the ones registered at the other address, and a switch back brings them back. Before a switch the console counts the subjects it would affect.',
    back: 'Switching back to the path address is always possible, whatever state a domain is in.',
  },
} as const;

export type DomainsWords = typeof DOMAINS_WORDS;

export function domainsArea(): { area: Area; title: string } {
  return areaTitled('domains');
}
