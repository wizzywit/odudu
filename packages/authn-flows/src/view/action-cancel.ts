import { type PageLocale } from '@odudu/kernel';
import { tHtml } from '#/view/messages';

// An action page is either one the person owes before the sign-in can finish,
// or one an application sent them to, which they may leave. Left out, it is
// the owed page.
export type ActionPageVariant = 'requested';

// Posts to the step the form already posts to, naming the way back: the
// button carries no value the server trusts beyond "the person left", and
// skips the form's own validation so it works with the fields empty.
export function cancelButton(variant: ActionPageVariant | undefined, locale: PageLocale): string {
  return variant === 'requested'
    ? ` <button type="submit" name="cancel" value="1" formnovalidate>${tHtml(locale, 'action.cancel')}</button>`
    : '';
}
