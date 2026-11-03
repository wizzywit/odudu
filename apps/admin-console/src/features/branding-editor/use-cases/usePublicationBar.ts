import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useThemeWrites } from '#/features/branding-editor/repository/useThemeWrites';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import {
  barMenu,
  discardView,
  holdNotes,
  outcomeView,
  publicationStatus,
  publishButton,
  type BarMenu,
  type DiscardView,
  type OutcomeView,
  type PublicationStatus,
} from '#/features/branding-editor/services/publicationBar';
import { revertTarget } from '#/features/branding-editor/services/tabs';
import {
  usePublication,
  type Publication,
} from '#/features/branding-editor/use-cases/usePublication';
import { usePublicationHolds } from '#/features/branding-editor/use-cases/usePublicationHolds';
import { useRevert, type Revert } from '#/features/branding-editor/use-cases/useRevert';
import { useThemeDiscard } from '#/features/branding-editor/use-cases/useThemeDiscard';
import type { Removal } from '#/shared/lib/use-cases/useConfirmedChange';

export interface PublicationBar {
  publication: Publication;
  discard: Removal;
  revert: Revert;
  // What the bar reads out of the above.
  bar: {
    status: PublicationStatus;
    publish: { label: string; short: string };
    notes: { publish: string | undefined; discard: string | undefined };
    outcome: OutcomeView;
    discard: DiscardView;
    menu: BarMenu;
  };
}

// What every tab shares: publishing the saved draft whole, and dropping it.
// The contrast pairs read the saved colours, which is what a publish checks.
export function usePublicationBar({
  tenant,
  scope,
  view,
  tag,
  tab,
  published,
  onPublished,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  // The tab being shown.
  tab: string;
  published: PublishOutcome;
  onPublished: (outcome: PublishOutcome) => void;
}): PublicationBar {
  const writes = useThemeWrites(tenant, scope);
  const holds = usePublicationHolds(tenant, scope, view);
  const target = revertTarget(tab);
  const revert = useRevert({ tenant, scope, view, tag, tab: target.tab });
  const publication = usePublication({
    tenant,
    scope,
    tag,
    hold: holds.publish,
    writes,
    outcome: published,
    onOutcome: onPublished,
  });
  const discard = useThemeDiscard(tenant, scope, tag, writes);
  return {
    revert,
    publication,
    discard,
    bar: {
      status: publicationStatus(view),
      publish: publishButton(publication.busy),
      notes: holdNotes(holds, view, publication.hold),
      outcome: outcomeView(publication.outcome, revert.problem),
      discard: discardView(scope, holds),
      menu: barMenu(
        {
          holds,
          tab: target.tab,
          revertOffered: target.offered,
          reverting: revert.busy,
        },
        { revert: revert.revert, discard: discard.ask },
      ),
    },
  };
}
