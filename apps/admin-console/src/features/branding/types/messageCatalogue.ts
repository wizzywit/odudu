import type { ThemePageKind } from '#/features/branding/types/theme';

export interface MessageCatalogueSection {
  kinds: ThemePageKind[];
  messages: { key: string; en: string }[];
}

// The messages a page, or a mail, is filled from, in key order, with the
// English text a key stands for.
export interface MessageCatalogue {
  sections: MessageCatalogueSection[];
}
