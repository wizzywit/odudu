import type { ThemeView } from '#/features/branding-editor/types/theme';
import type { MessageKeys } from '#/features/branding-editor/services/catalogue';
import { chooseKind, type PageKind } from '#/features/branding-editor/services/pageKinds';
import {
  PAGES_WORDS,
  partsView,
  templateWords,
  type PagesWords,
  type PartsView,
  type TemplateWords,
} from '#/features/branding-editor/services/pagesTab';
import type { PlacedProblems } from '#/features/branding-editor/services/problems';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import type { SizeReading } from '#/shared/lib/services/format';
import { useMessageKeys } from '#/features/branding-editor/use-cases/useMessageKeys';
import { useRevert, type Revert } from '#/features/branding-editor/use-cases/useRevert';
import { useTemplates } from '#/features/branding-editor/use-cases/useTemplates';
import type { SectionSave } from '#/shared/lib/repository/useSectionSave';
import type { TemplateValues } from '#/features/branding-editor/services/templateValues';
import { useFolds } from '#/shared/lib/use-cases/useFolds';

export interface PagesTab {
  section: { save: SectionSave<TemplateValues>; blocked: string | undefined };
  words: PagesWords;
  // The page being edited, and the choice of another.
  choose: (id: string) => void;
  editor: {
    words: TemplateWords;
    keys: MessageKeys;
    text: string;
    size: SizeReading;
    problems: PlacedProblems;
    changed: boolean;
    wrap: { on: boolean; toggle: () => void };
    edit: (text: string) => void;
  };
  revert: Revert;
  parts: { view: PartsView; toggle: () => void };
}

export function usePagesTab({
  tenant,
  scope,
  view,
  tag,
  gone,
  kind,
  onKind,
  published,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
  kind: PageKind;
  onKind: (kind: PageKind) => void;
  published: PublishOutcome;
}): PagesTab {
  const templates = useTemplates({ tenant, scope, view, tag, gone, published });
  const revert = useRevert({ tenant, scope, view, tag, tab: 'pages' });
  const keys = useMessageKeys(tenant, kind);
  const folds = useFolds();
  return {
    section: { save: templates.save, blocked: templates.blocked },
    words: PAGES_WORDS,
    choose: (id) => {
      chooseKind(id, onKind);
    },
    editor: {
      words: templateWords(kind, scope, view),
      keys,
      text: templates.text(kind),
      size: templates.size(kind),
      problems: templates.problems(kind),
      changed: templates.changed(kind),
      wrap: {
        on: folds.isOpen('wrap'),
        toggle: () => {
          folds.toggle('wrap');
        },
      },
      edit: (text) => {
        templates.edit(kind, text);
      },
    },
    revert,
    parts: {
      view: partsView(kind, folds.isOpen('parts')),
      toggle: () => {
        folds.toggle('parts');
      },
    },
  };
}
