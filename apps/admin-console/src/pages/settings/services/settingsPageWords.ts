import { areaTitled, type Area } from '#/entities/area';

export const SETTINGS_PAGE_WORDS = {
  description:
    'How this tenant signs people in, what it asks of their passwords, and how long it keeps what it records. Every section saves on its own.',
  navLabel: 'On this page',
  loading: 'Loading the settings',
  failed: 'The settings could not be loaded',
} as const;

export type SettingsPageWords = typeof SETTINGS_PAGE_WORDS;

export function settingsPage(): { area: Area; title: string; words: SettingsPageWords } {
  return { ...areaTitled('settings'), words: SETTINGS_PAGE_WORDS };
}
