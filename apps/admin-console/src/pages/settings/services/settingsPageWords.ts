import { areaTitled, type Area } from '#/entities/area';

export const SETTINGS_PAGE_WORDS = {
  description:
    'How this tenant signs people in, what it asks of their passwords, and how long it keeps what it records. Every section saves on its own.',
  navLabel: 'On this page',
  loading: 'Loading the settings',
  failed: 'The settings could not be loaded',
} as const;

export const SETTINGS_WORDS = {
  registrationTitle: 'Client registration',
  registrationDescription:
    'How applications become clients of this tenant: by registering themselves, or by naming a metadata document.',
  policyLabel: 'Policy',
  mcpOption: 'MCP clients: public clients of the MCP server may register',
  cimdLabel: 'Accept client metadata documents',
  cimdDescription:
    'A client may use an HTTPS address as its client_id, and the document served there describes it. Works under any policy; the MCP audience is granted only under the MCP policy.',
} as const;

export type SettingsPageWords = typeof SETTINGS_PAGE_WORDS;

export function settingsPage(): { area: Area; title: string; words: SettingsPageWords } {
  return { ...areaTitled('settings'), words: SETTINGS_PAGE_WORDS };
}
