import { addressPath, type PageLocale, type RenderedPage, type TenantAddress } from '@odudu/kernel';
import { type ProfileOffer, type ProfileProblem } from '#/usecase/update-profile-action';
import { cancelButton, type ActionPageVariant } from '#/view/action-cancel';
import { escapeHtml, intro, page } from '#/view/document';
import { invalidAttributes, problemSummary, type Problem } from '#/view/form-error';
import { t, tHtml, type MessageId } from '#/view/messages';
import { fillPage } from '#/view/template';

interface FieldKind {
  readonly type: 'text' | 'url' | 'tel';
  readonly autocomplete: string;
}

// How each editable field is asked for: the input type, and what a browser may
// offer to fill it from. An unlisted field is plain text with no suggestion.
const FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
  username: { type: 'text', autocomplete: 'username' },
  name: { type: 'text', autocomplete: 'name' },
  given_name: { type: 'text', autocomplete: 'given-name' },
  family_name: { type: 'text', autocomplete: 'family-name' },
  middle_name: { type: 'text', autocomplete: 'additional-name' },
  nickname: { type: 'text', autocomplete: 'nickname' },
  profile: { type: 'url', autocomplete: 'url' },
  picture: { type: 'url', autocomplete: 'off' },
  website: { type: 'url', autocomplete: 'url' },
  gender: { type: 'text', autocomplete: 'sex' },
  birthdate: { type: 'text', autocomplete: 'bday' },
  phone_number: { type: 'tel', autocomplete: 'tel' },
  address_street: { type: 'text', autocomplete: 'address-line1' },
  address_locality: { type: 'text', autocomplete: 'address-level2' },
  address_region: { type: 'text', autocomplete: 'address-level1' },
  address_postal_code: { type: 'text', autocomplete: 'postal-code' },
  address_country: { type: 'text', autocomplete: 'country' },
};

const PLAIN: FieldKind = { type: 'text', autocomplete: 'off' };

const SHAPE_MESSAGE: Readonly<Record<string, MessageId>> = {
  birthdate: 'updateProfile.invalid.birthdate',
  zoneinfo: 'updateProfile.invalid.zoneinfo',
  locale: 'updateProfile.invalid.locale',
  profile: 'updateProfile.invalid.url',
  picture: 'updateProfile.invalid.url',
  website: 'updateProfile.invalid.url',
};

// The catalogue's key for a field's label: its wire name in camel case, which
// a theme can name in a `{{t "key"}}`.
function labelId(field: string): MessageId {
  const camel = field.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
  return `updateProfile.field.${camel}` as MessageId;
}

function labelOf(field: string, locale: PageLocale): string {
  return t(locale, labelId(field));
}

function problemsOf(problems: readonly ProfileProblem[], locale: PageLocale): Problem[] {
  return problems.map((problem): Problem => {
    if (problem.kind === 'unfilled') {
      return { fields: problem.fields, html: tHtml(locale, 'updateProfile.unfilled') };
    }
    if (problem.kind === 'username_taken') {
      return { fields: ['username'], html: tHtml(locale, 'updateProfile.usernameTaken') };
    }
    const id: MessageId =
      problem.reason === 'bidi'
        ? 'updateProfile.invalid.bidi'
        : (SHAPE_MESSAGE[problem.field] ?? 'updateProfile.invalid.value');
    return {
      fields: [problem.field],
      html: tHtml(locale, id, { field: labelOf(problem.field, locale) }),
    };
  });
}

function fieldHtml(
  field: string,
  value: string,
  problems: readonly Problem[],
  locale: PageLocale,
): string {
  const kind = FIELD_KINDS[field] ?? PLAIN;
  return `<label>${tHtml(locale, labelId(field))} <input type="${kind.type}" name="${field}" value="${escapeHtml(value)}" autocomplete="${kind.autocomplete}"${invalidAttributes(problems, field)}></label>`;
}

function updateProfilePage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: ProfileOffer,
  problems: readonly ProfileProblem[],
  locale: PageLocale,
  variant: ActionPageVariant | undefined,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=update-profile'),
  );
  const shown = problemsOf(problems, locale);
  const body = fillPage(
    'update-profile',
    {
      intro: intro(tHtml(locale, 'updateProfile.title'), tenant),
      error: problemSummary(shown),
      'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
      fields: offer.fields
        .map((field) => fieldHtml(field, offer.values[field] ?? '', shown, locale))
        .join('\n  '),
      submit: `<button type="submit">${tHtml(locale, 'updateProfile.submit')}</button>${cancelButton(variant, locale)}`,
      'form.close': '</form>',
    },
    locale,
    variant === 'requested'
      ? { from: 'updateProfile.intro', to: 'updateProfile.requestedIntro' }
      : undefined,
  );
  return page(t(locale, 'updateProfile.title'), body, null, [], locale, 'update-profile');
}

// The page a login parks on while `update-profile` is owed, and the page a form
// that was refused comes back to.
export function renderUpdateProfilePage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: ProfileOffer,
  problems: readonly ProfileProblem[],
  locale: PageLocale,
): RenderedPage {
  return updateProfilePage(tenant, address, authSessionId, offer, problems, locale, undefined);
}

// The same page for a person an application sent here, who may leave it again.
export function renderRequestedUpdateProfilePage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  offer: ProfileOffer,
  problems: readonly ProfileProblem[],
  locale: PageLocale,
): RenderedPage {
  return updateProfilePage(tenant, address, authSessionId, offer, problems, locale, 'requested');
}
