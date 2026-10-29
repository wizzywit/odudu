import { stripBidiControls } from '@odudu/contracts';
import { negotiateLocale, type PageLocale } from '@odudu/i18n';
import { type MailBranding } from '@odudu/kernel';
import { bdi, catalogue, en, t, tHtml, type MessageId } from '#/service/messages';
import { renderShell, safeHref, sendYear, type Block } from '#/service/shell';
import { type EmailMessage } from '#/service/sender';

// What every mail takes beyond its own content.
interface MailContext {
  // The recipient's own `locale` where the sender knows it, else the tenant's
  // default, else none: the mail is then English. A tag this build holds no
  // catalogue for is reduced to the nearest one it does, as a page's is.
  readonly locale?: string | null | undefined;
  readonly tenantDefaultLocale?: string | null | undefined;
  // The tenant's theme as resolved when the mail is queued; absent, the mail
  // is drawn in Odudu's own colours.
  readonly branding?: MailBranding | null | undefined;
  // The tenant's own wording, by language; the mail reads the one of its own.
  readonly overrides?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
}

interface MailInput extends MailContext {
  readonly to: string;
  readonly link: string;
  readonly tenantDisplayName: string;
  // The send time, from the caller's clock: the footer's year is its UTC year.
  readonly now: Date;
}

export type VerifyEmailInput = MailInput;
export type FinishRegistrationInput = MailInput;
export type ResetPasswordInput = MailInput;

export interface RequiredActionsInput extends MailInput {
  /** The codes of what each action asks of the subject, in the order it will be asked. */
  readonly actions: readonly string[];
}

const FSI = '\u2068';
const PDI = '\u2069';

// C0 and C1 controls, which include CR, LF and NEL, and the Unicode line and
// paragraph separators.
const LINE_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/gu;

function mailLocale({ locale, tenantDefaultLocale, overrides }: MailContext): PageLocale {
  const negotiated = negotiateLocale({
    uiLocales: [],
    subjectLocale: locale ?? null,
    authenticated: true,
    tenantDefault: tenantDefaultLocale ?? null,
    acceptLanguage: null,
    supported: catalogue.locales,
  });
  const own = overrides?.[negotiated.tag];
  return own === undefined || !Object.hasOwn(overrides ?? {}, negotiated.tag)
    ? negotiated
    : { ...negotiated, overrides: own };
}

// A header cannot carry an isolate, so the subject loses the controls that
// would reorder it and every character that could end the header line.
function inSubject(name: string): string {
  return stripBidiControls(name).replace(LINE_CONTROLS, ' ').trim();
}

// An isolate holds the name's own direction inside the sentence around it. The
// name loses the controls that could close that isolate early and every line
// break, so it cannot start a line of its own.
function inText(name: string): string {
  return `${FSI}${stripBidiControls(name).replace(LINE_CONTROLS, ' ')}${PDI}`;
}

function actionId(code: string): MessageId | null {
  const id = `action.${code}`;
  return Object.hasOwn(en, id) ? (id as MessageId) : null;
}

function actionText(locale: PageLocale, code: string): string {
  const id = actionId(code);
  return id === null ? inText(code) : t(locale, id);
}

function actionHtml(locale: PageLocale, code: string): string {
  const id = actionId(code);
  return id === null ? bdi(stripBidiControls(code)) : tHtml(locale, id);
}

const NAME_LIMIT = 80;

// A display name is the tenant's own text and can be any length; the mail
// shows its first characters and an ellipsis. Cut by code point, before
// anything is escaped.
function clipName(name: string): string {
  const points = Array.from(name);
  return points.length <= NAME_LIMIT ? name : `${points.slice(0, NAME_LIMIT).join('')}\u2026`;
}

const SIGNATURE_RULE = '--';
const DOT = ' · ';

// What the HTML footer says, for the reader of the plain-text part.
function textFooter(locale: PageLocale, reason: MessageId, tenant: string, now: Date): string {
  const year = String(sendYear(now));
  return [
    SIGNATURE_RULE,
    t(locale, reason, { tenant: inText(tenant) }),
    `${t(locale, 'mail.copyright', { year })}${DOT}${t(locale, 'mail.poweredBy')}`,
  ].join('\n');
}

const paragraph = (html: string): Block => ({ kind: 'paragraph', html });

interface Page {
  readonly locale: PageLocale;
  readonly tenant: string;
  readonly now: Date;
  readonly heading: MessageId;
  readonly preheader: MessageId;
  readonly reason: MessageId;
  readonly branding: MailBranding | null | undefined;
}

function page(
  spec: Page,
): Pick<
  Parameters<typeof renderShell>[0],
  'locale' | 'tenant' | 'now' | 'heading' | 'preheader' | 'reason' | 'branding'
> {
  return {
    locale: spec.locale,
    tenant: stripBidiControls(spec.tenant),
    now: spec.now,
    heading: t(spec.locale, spec.heading),
    preheader: t(spec.locale, spec.preheader),
    reason: tHtml(spec.locale, spec.reason, {}, { tenant: stripBidiControls(spec.tenant) }),
    branding: spec.branding,
  };
}

interface Linked {
  readonly kind: 'verify' | 'reset' | 'finish';
  readonly input: MailInput;
}

function renderLinked({ kind, input }: Linked): EmailMessage {
  const locale = mailLocale(input);
  const tenant = clipName(input.tenantDisplayName);
  const link = safeHref(input.link);
  return {
    to: input.to,
    subject: inSubject(t(locale, `${kind}.subject`, { tenant: inSubject(tenant) })),
    text: `${t(locale, `${kind}.text`, { tenant: inText(tenant) })}\n\n${link}\n\n${t(locale, 'mail.notRequested')}\n\n${textFooter(locale, `${kind}.reason`, tenant, input.now)}`,
    html: renderShell({
      ...page({
        locale,
        tenant,
        now: input.now,
        heading: `${kind}.heading`,
        preheader: `${kind}.preheader`,
        reason: `${kind}.reason`,
        branding: input.branding,
      }),
      blocks: [paragraph(tHtml(locale, `${kind}.body`, {}, { tenant: stripBidiControls(tenant) }))],
      action: { label: t(locale, `${kind}.button`), href: link },
      closing: [tHtml(locale, 'mail.notRequested')],
    }),
  };
}

export function renderVerifyEmail(input: VerifyEmailInput): EmailMessage {
  return renderLinked({ kind: 'verify', input });
}

// The link of a registration that is waiting: it creates nothing by itself,
// and says so, because the person it reaches may never have asked.
export function renderFinishRegistration(input: FinishRegistrationInput): EmailMessage {
  return renderLinked({ kind: 'finish', input });
}

export function renderResetPassword(input: ResetPasswordInput): EmailMessage {
  return renderLinked({ kind: 'reset', input });
}

export interface RegistrationDuplicateInput extends MailContext {
  readonly to: string;
  /** Where a forgotten password is reset; null where the tenant has no reset. */
  readonly resetLink: string | null;
  readonly tenantDisplayName: string;
  readonly now: Date;
  readonly locale?: string | null | undefined;
}

// Said to an address somebody tried to register again. It tells the holder
// what happened and names nothing about the attempt: no username, no token.
export function renderRegistrationDuplicate(input: RegistrationDuplicateInput): EmailMessage {
  const locale = mailLocale(input);
  const tenant = clipName(input.tenantDisplayName);
  const link = input.resetLink === null ? null : safeHref(input.resetLink);
  const next: MessageId = link === null ? 'duplicate.nextSignIn' : 'duplicate.next';
  return {
    to: input.to,
    subject: inSubject(t(locale, 'duplicate.subject', { tenant: inSubject(tenant) })),
    text: [
      t(locale, 'duplicate.text', { tenant: inText(tenant) }),
      t(locale, next),
      ...(link === null ? [] : [link]),
      t(locale, 'mail.notRequested'),
      textFooter(locale, 'duplicate.reason', tenant, input.now),
    ].join('\n\n'),
    html: renderShell({
      ...page({
        locale,
        tenant,
        now: input.now,
        heading: 'duplicate.heading',
        preheader: 'duplicate.preheader',
        reason: 'duplicate.reason',
        branding: input.branding,
      }),
      blocks: [
        paragraph(tHtml(locale, 'duplicate.text', {}, { tenant: stripBidiControls(tenant) })),
        paragraph(tHtml(locale, next)),
      ],
      action: link === null ? undefined : { label: t(locale, 'duplicate.button'), href: link },
      closing: [tHtml(locale, 'mail.notRequested')],
    }),
  };
}

export function renderRequiredActions(input: RequiredActionsInput): EmailMessage {
  const locale = mailLocale(input);
  const tenant = clipName(input.tenantDisplayName);
  const link = safeHref(input.link);
  const listed = input.actions.map((code) => `- ${actionText(locale, code)}`).join('\n');
  return {
    to: input.to,
    subject: inSubject(t(locale, 'actions.subject', { tenant: inSubject(tenant) })),
    text: `${t(locale, 'actions.text', { tenant: inText(tenant) })}\n\n${listed}\n\n${t(locale, 'actions.textLink')}\n\n${link}\n\n${t(locale, 'actions.ignore')}\n\n${textFooter(locale, 'actions.reason', tenant, input.now)}`,
    html: renderShell({
      ...page({
        locale,
        tenant,
        now: input.now,
        heading: 'actions.heading',
        preheader: 'actions.preheader',
        reason: 'actions.reason',
        branding: input.branding,
      }),
      blocks: [
        paragraph(tHtml(locale, 'actions.text', {}, { tenant: stripBidiControls(tenant) })),
        { kind: 'list', items: input.actions.map((code) => actionHtml(locale, code)) },
      ],
      action: { label: t(locale, 'actions.button'), href: link },
      closing: [tHtml(locale, 'actions.ignore')],
    }),
  };
}

interface NoticeInput extends MailContext {
  readonly to: string;
  readonly tenantDisplayName: string;
  readonly now: Date;
  readonly locale?: string | null | undefined;
}

export interface SecondFactorRemovedInput extends NoticeInput {
  readonly factor: 'totp' | 'webauthn';
  /** Whether the subject's recovery codes were removed with the factor. */
  readonly codes: boolean;
}

export interface RecoveryCodesRevokedInput extends NoticeInput {
  /** Whether the next sign-in asks the subject to save a new set. */
  readonly newSet: boolean;
}

interface Notice {
  readonly input: NoticeInput;
  readonly subject: MessageId;
  readonly heading: MessageId;
  readonly preheader: MessageId;
  readonly reason: MessageId;
  // The sentences of the notice, the first naming the tenant.
  readonly lines: readonly MessageId[];
}

// Said to the address on file after an administrator changes how the
// subject recovers or proves who they are. Never a link, a code or a secret:
// whoever reads it may not be the subject, and nothing in it helps them.
function renderNotice({ input, subject, heading, preheader, reason, lines }: Notice): EmailMessage {
  const locale = mailLocale(input);
  const tenant = clipName(input.tenantDisplayName);
  const sentences = lines.map((id) => ({
    text: t(locale, id, { tenant: inText(tenant) }),
    html: tHtml(locale, id, {}, { tenant: stripBidiControls(tenant) }),
  }));
  return {
    to: input.to,
    subject: inSubject(t(locale, subject, { tenant: inSubject(tenant) })),
    text: [
      ...sentences.map((line) => line.text),
      t(locale, 'notice.contact'),
      textFooter(locale, reason, tenant, input.now),
    ].join('\n\n'),
    html: renderShell({
      ...page({
        locale,
        tenant,
        now: input.now,
        heading,
        preheader,
        reason,
        branding: input.branding,
      }),
      blocks: sentences.map((line) => paragraph(line.html)),
      closing: [tHtml(locale, 'notice.contact')],
    }),
  };
}

export function renderSecondFactorRemoved(input: SecondFactorRemovedInput): EmailMessage {
  return renderNotice({
    input,
    subject: 'factorRemoved.subject',
    heading: 'factorRemoved.heading',
    preheader: 'factorRemoved.preheader',
    reason: 'factorRemoved.reason',
    lines: [
      `factorRemoved.${input.factor}`,
      ...(input.codes ? (['factorRemoved.codes'] as const) : []),
    ],
  });
}

export function renderRecoveryCodesRevoked(input: RecoveryCodesRevokedInput): EmailMessage {
  return renderNotice({
    input,
    subject: 'recoveryRevoked.subject',
    heading: 'recoveryRevoked.heading',
    preheader: 'recoveryRevoked.preheader',
    reason: 'recoveryRevoked.reason',
    lines: ['recoveryRevoked.text', ...(input.newSet ? (['recoveryRevoked.newSet'] as const) : [])],
  });
}

export interface SmtpTestInput extends MailContext {
  readonly to: string;
  readonly tenantDisplayName: string;
  readonly now: Date;
  readonly locale?: string | null | undefined;
}

export function renderSmtpTest(input: SmtpTestInput): EmailMessage {
  const locale = mailLocale(input);
  const tenant = clipName(input.tenantDisplayName);
  return {
    to: input.to,
    subject: inSubject(t(locale, 'smtpTest.subject')),
    text: `${t(locale, 'smtpTest.text')}\n\n${textFooter(locale, 'smtpTest.reason', tenant, input.now)}`,
    html: renderShell({
      ...page({
        locale,
        tenant,
        now: input.now,
        heading: 'smtpTest.heading',
        preheader: 'smtpTest.preheader',
        reason: 'smtpTest.reason',
        branding: input.branding,
      }),
      blocks: [paragraph(tHtml(locale, 'smtpTest.text'))],
    }),
  };
}
