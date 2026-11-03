import type { PreviewChoice } from '#/features/branding/services/preview';
import type { ThemeView } from '@odudu/contracts/admin';
import { tabNamed } from '#/shared/services/record';
import { OFFERED_TABS, type OfferedTab } from '#/features/branding/services/tabs';

export function previewWith(choice: PreviewChoice, change: Partial<PreviewChoice>): PreviewChoice {
  return { ...choice, ...change };
}

// A frame reloads when what it shows may have changed: the published version,
// the draft, or what is asked of it.
export function previewKey(
  view: ThemeView | undefined,
  tag: string | null,
  choice: PreviewChoice,
): string {
  return `${String(view?.published?.version ?? 0)}|${tag ?? ''}|${choice.kind}|${choice.scheme}`;
}

// Runs `select` for a tab this area has, and for no other name.
export function selectOffered(name: string, select: (tab: OfferedTab) => void): void {
  const tab = tabNamed(OFFERED_TABS, name);
  if (tab !== undefined) select(tab);
}
