import {
  markedLabel,
  PASSWORD_RULES_LIST_ID,
  passwordHints,
  type PageLocale,
  type PageScript,
  type PasswordRules,
} from '@odudu/kernel';
import { invalidAttributes, type Problem } from '#/view/form-error';
import { tHtml, type MessageId } from '#/view/messages';

// The new-password field every account page shares: its label, the rules the
// tenant holds the password to, and the script that checks them as it is
// typed. `script` is for the page to return, so its policy names the script
// this markup carries.
export function passwordField(
  label: MessageId,
  rules: PasswordRules,
  problems: readonly Problem[],
  autofocus: boolean,
  locale: PageLocale,
  marked = false,
): { html: string; script: PageScript } {
  const hints = passwordHints(rules, {
    heading: tHtml(locale, 'password.hint.heading'),
    minLength: tHtml(locale, 'password.hint.minLength', { min: rules.minLength }),
    digit: tHtml(locale, 'password.hint.digit'),
    uppercase: tHtml(locale, 'password.hint.uppercase'),
    lowercase: tHtml(locale, 'password.hint.lowercase'),
    special: tHtml(locale, 'password.hint.special'),
    notCommon: tHtml(locale, 'password.hint.notCommon'),
    show: tHtml(locale, 'password.hint.show'),
    summary: tHtml(locale, 'password.hint.summary', { met: '{met}', total: '{total}' }),
  });
  const attributes = `${invalidAttributes(problems, 'password', [PASSWORD_RULES_LIST_ID])}${autofocus ? ' autofocus' : ''}`;
  return {
    html: `<label>${marked ? markedLabel(tHtml(locale, label), true, tHtml(locale, 'registration.required')) : tHtml(locale, label)} <input type="password" name="password" autocomplete="new-password"${marked ? ' required' : ''}${hints.field}${attributes}></label>\n${hints.markup}`,
    script: hints.script,
  };
}
