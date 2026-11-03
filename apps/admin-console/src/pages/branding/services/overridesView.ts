import type { MessageOverride } from '#/pages/branding/types/messageOverride';
import { spaced } from '#/shared/lib/services/format';
import type { Choice } from '#/shared/lib/services/choice';
import type { Conflict } from '#/shared/lib/services/conflict';
import {
  conflictFields,
  conflictLead,
  conflictSection,
  type OverrideConflict,
} from '#/pages/branding/services/overrideConflicts';
import {
  EDIT_HINT,
  KEY_LABEL,
  KEY_NOTE,
  MESSAGE_LABEL,
  NOTHING_YET,
  NOUN,
  OVERRIDE_LENGTH,
  OVERRIDE_LOCALE_LABEL,
  OVERRIDE_MESSAGE_NOTE,
  OVERRIDES_DESCRIPTION,
  OVERRIDES_TITLE,
  SAVE_OVERRIDE,
} from '#/pages/branding/services/overrideForm';
import { capText } from '#/pages/branding/services/overrideList';
import { overrideLocales } from '#/pages/branding/services/supportedLanguages';

export const OVERRIDES_WORDS = { title: OVERRIDES_TITLE, lead: OVERRIDES_DESCRIPTION } as const;

export interface LocaleView {
  label: string;
  options: Choice[];
  value: string;
}

export function localeView(supported: readonly string[], locale: string): LocaleView {
  return { label: OVERRIDE_LOCALE_LABEL, options: overrideLocales(supported), value: locale };
}

export interface FormWords {
  keyLabel: string;
  keyNote: string;
  messageLabel: string;
  messageNote: string;
  messageLimit: number;
  save: string;
  lastLabel: string;
}

// The form's words, its button saying so while a save is under way.
export function formWords(saving: boolean): FormWords {
  return {
    keyLabel: KEY_LABEL,
    keyNote: KEY_NOTE,
    messageLabel: MESSAGE_LABEL,
    messageNote: spaced(OVERRIDE_MESSAGE_NOTE, EDIT_HINT),
    messageLimit: OVERRIDE_LENGTH,
    save: saving ? 'Saving…' : SAVE_OVERRIDE,
    lastLabel: 'Last override',
  };
}

export interface OverrideLine extends MessageOverride {
  editName: string;
  removeName: string;
}

export interface TableWords {
  label: string;
  loading: string;
  failed: string;
  refused: { capability: 'manage-tenant'; noun: string };
  emptyTitle: string;
  empty: string;
  noun: string;
  columns: { key: string; text: string; changed: string; actions: string };
  edit: string;
  remove: string;
}

export const TABLE_WORDS: TableWords = {
  label: OVERRIDES_TITLE,
  loading: 'Loading the overrides',
  failed: 'The overrides could not be loaded',
  refused: { capability: 'manage-tenant', noun: OVERRIDES_TITLE },
  emptyTitle: 'No overrides yet',
  empty: NOTHING_YET,
  noun: NOUN.other,
  columns: { key: 'Key', text: 'Text', changed: 'Changed', actions: 'Actions' },
  edit: 'Edit',
  remove: 'Remove',
};

export interface TableView {
  words: TableWords;
  lines: OverrideLine[];
  // How many are loaded, as a line above the table.
  cap: string;
}

export function tableView(rows: readonly MessageOverride[], more: boolean): TableView {
  return {
    words: TABLE_WORDS,
    lines: rows.map((row) => ({
      ...row,
      editName: `Edit ${row.key}`,
      removeName: `Remove ${row.key}`,
    })),
    cap: capText(rows.length, more),
  };
}

export const REMOVAL_WORDS = {
  title: 'Remove this override?',
  confirmLabel: 'Remove override',
  lastLabel: 'Last removal',
} as const;

export interface ConflictView {
  id: string;
  section: string;
  fields: Conflict[];
  lead: string;
  source: OverrideConflict;
}

export function conflictViews(conflicts: readonly OverrideConflict[]): ConflictView[] {
  return conflicts.map((conflict) => ({
    id: `${conflict.locale}/${conflict.key}`,
    section: conflictSection(conflict),
    fields: conflictFields(conflict),
    lead: conflictLead(conflict),
    source: conflict,
  }));
}
