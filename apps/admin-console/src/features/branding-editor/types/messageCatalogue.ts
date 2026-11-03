import type { ThemePageKind } from '#/features/branding-editor/types/theme';

export interface MessageCatalogueSection {
  kinds: ThemePageKind[];
  messages: { key: string; en: string }[];
}

// The messages a page, or a mail, is filled from, in key order, with the
// English text a key stands for.
export interface MessageCatalogue {
  sections: MessageCatalogueSection[];
}

export interface MessageEntry {
  key: string;
  // The English text, as the catalogue holds it.
  text: string;
  // Where the message is shown when that is not a page: set for mail.
  group?: string;
}
