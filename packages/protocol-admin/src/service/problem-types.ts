export interface AdminProblemType {
  readonly status: number;
  readonly summary: string;
}

// What a problem whose `type` is plain `about:blank` says: nothing beyond its status.
export const GENERIC_PROBLEM_SUMMARY =
  'A problem with `type` `about:blank` carries no more meaning than its HTTP status and ' +
  '`title`: `detail` says what was wrong with this request. Most refusals are of this kind.';

// The refusals that have a type of their own, keyed by the fragment after
// `about:blank#`, which a client can switch on without reading `detail`.
export const ADMIN_PROBLEM_TYPES: Readonly<Record<string, AdminProblemType>> = {
  'audit-query-too-broad': {
    status: 400,
    summary:
      'The audit read ran past its five second bound because its filters match too many rows ' +
      'to serve cheaply. Narrow the time range with `from` and `to`.',
  },
  'service-account': {
    status: 409,
    summary:
      'A subject that is a client\u2019s service account is not deleted on its own, since the ' +
      'client would be left with none. `detail` names the client. Delete the client instead, ' +
      'which deletes its account.',
  },
  'builtin-scope-confirmation': {
    status: 422,
    summary:
      'A built-in scope is deleted only when the request\u2019s `confirm` names it again. ' +
      '`detail` names the scope and how many clients and roles would lose it. Repeat the ' +
      'request with `confirm` set to the scope name.',
  },
  'export-too-large': {
    status: 413,
    summary:
      'An audit export or a tenant export would be larger than the cap, and is refused whole ' +
      'rather than cut short. Narrow the audit export with `from`, `to` or another filter.',
  },
  'flow-duplicate-authenticator': {
    status: 400,
    summary:
      'A replacement authentication flow names the same authenticator in two steps. A step is ' +
      'addressed by its authenticator, so a repeat has no unambiguous meaning.',
  },
  'flow-empty': {
    status: 400,
    summary:
      'A replacement authentication flow has no steps. A tenant with no flow cannot be logged ' +
      'into.',
  },
  'flow-no-enabled-step': {
    status: 400,
    summary: 'Every step of a replacement authentication flow is disabled, so nobody could log in.',
  },
  'flow-no-first-challenge': {
    status: 400,
    summary:
      'No step of a replacement authentication flow would run at the start of a login, when ' +
      'no subject is bound yet.',
  },
  'flow-unknown-authenticator': {
    status: 400,
    summary:
      'A step of a replacement authentication flow names an authenticator that is not ' +
      'registered. `detail` lists the ones that are.',
  },
  'key-active': {
    status: 409,
    summary: 'The signing key is the active one and cannot be retired. Promote another key first.',
  },
  'key-algorithm-needed': {
    status: 409,
    summary:
      'Retiring the signing key would leave no key for an algorithm a client still requires ' +
      'for its ID tokens or UserInfo responses. `detail` names the clients.',
  },
  'key-not-retired': {
    status: 409,
    summary: 'Only a retired signing key can be deleted. Retire it first.',
  },
  'last-administrator': {
    status: 409,
    summary:
      'The write would leave the tenant with no enabled administrator. `detail` names who ' +
      'would be the last.',
  },
  'logout-deliveries-pending': {
    status: 409,
    summary:
      'The tenant still has back-channel logout tokens to send, and deleting it would ' +
      'discard them. Wait for them to be delivered.',
  },
  'no-email': {
    status: 409,
    summary: 'The subject has no email address to send the message to.',
  },
  'no-mail-relay': {
    status: 409,
    summary:
      'The tenant has no SMTP relay and the deployment no sender, so the mail would only be ' +
      'logged.',
  },
  'reset-password-off': {
    status: 409,
    summary:
      'The tenant has `reset_password_allowed` off, so it would refuse the link. Turn the ' +
      'setting on first.',
  },
  'sessions-live': {
    status: 409,
    summary:
      'Deleting the tenant was refused because sessions are still live. Disable the tenant ' +
      'again to end them and tell their relying parties.',
  },
  'sessions-not-ended': {
    status: 500,
    summary:
      'The tenant was disabled, but ending its sessions did not finish. Repeat the request to ' +
      'finish it.',
  },
  'message-overrides-full': {
    status: 409,
    summary:
      'The tenant already holds 500 message overrides, across every locale, and this one would ' +
      'be the 501st. Delete one first; changing an override that exists is always allowed.',
  },
  'asset-in-use': {
    status: 409,
    summary:
      'An uploaded image is not deleted while a draft or a published theme of the tenant or ' +
      'of one of its clients names it. `errors` lists the first 20, each by the theme\u2019s ' +
      'path (`clients/<uuid>/theme` is the client\u2019s row `id`) and the version that names it; save or publish a theme without the image first.',
  },
  'asset-cap': {
    status: 409,
    summary:
      'The tenant\u2019s stored images, the new one included, would pass 8 MiB. Delete an ' +
      'image that no theme names.',
  },
  'asset-unsupported-type': {
    status: 415,
    summary:
      'The upload is not a PNG, a JPEG or a WebP, whatever its `Content-Type` said. An ' +
      'SVG, a GIF, an AVIF and a document are refused.',
  },
  'asset-animated': {
    status: 422,
    summary: 'The upload is animated (an APNG, an animated WebP), which no slot accepts.',
  },
  'asset-corrupt': {
    status: 422,
    summary: 'The upload could not be decoded as the image its bytes claim to be, or is empty.',
  },
  'asset-dimensions': {
    status: 422,
    summary:
      'The image is wider or taller than its kind allows, or holds too many pixels to decode. ' +
      '`detail` gives the limit.',
  },
  'asset-timeout': {
    status: 422,
    summary: 'Decoding the image ran past the time the server allows, so it was abandoned.',
  },
  'asset-too-large': {
    status: 413,
    summary:
      'The image is over its kind\u2019s size, as uploaded or once the server re-encoded it. ' +
      'A body over the limit is refused with a plain `413` before it is read.',
  },
  'asset-busy': {
    status: 503,
    summary:
      'The server is decoding as many images as it will at once, and others are waiting. ' +
      'Repeat the upload after the `Retry-After` interval.',
  },
  'theme-assets-missing': {
    status: 409,
    summary:
      'An earlier version of a theme names an image that has since been deleted, so it cannot ' +
      'be restored whole. `errors` names each image by the slot that holds it.',
  },
  'theme-version-fails-checks': {
    status: 409,
    summary:
      'An earlier version of a theme has a template or stylesheet that fails the checks as ' +
      'they are now, so restoring it would show the default for that piece. `errors` lists ' +
      'them. Save a corrected draft and publish it instead.',
  },
  'theme-preview-too-large': {
    status: 422,
    summary:
      'The preview of a draft is not rendered because its stylesheet and the images the page ' +
      'shows come to over about 2.2 MiB once inlined. Use smaller images, or preview a page that ' +
      'shows fewer of them.',
  },
  'theme-no-draft': {
    status: 409,
    summary:
      'There is no draft to publish: none was saved, or another request has already published ' +
      'it. Save a draft again.',
  },
  'theme-nothing-to-publish': {
    status: 409,
    summary:
      'The draft has the content that is already published, so publishing it would only add ' +
      'an identical version. Change the draft first, or discard it.',
  },
  'tenant-enabled': {
    status: 409,
    summary:
      'A tenant must be disabled before it is deleted, which ends its sessions and tells ' +
      'their relying parties.',
  },
};

export function problemTypeUri(name: string): string {
  return `about:blank#${name}`;
}
