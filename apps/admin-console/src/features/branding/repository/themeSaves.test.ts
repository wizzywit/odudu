import type { ThemeView } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { colourSave, imageSave, templateSave } from '#/features/branding/repository/themeSaves';
import {
  colourValues,
  imageValues,
  NO_DRAFT_TAG,
  templateValues,
} from '#/features/branding/service';
import { draftedView, TH } from '#/testing/brandingFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

const view = draftedView() as ThemeView;
const TENANT = { kind: 'tenant' } as const;

it('each section saves the whole draft, its own part as edited', async () => {
  const { transport, sent } = fakeTransport({ [`PUT ${TH}`]: json(view, 200, { etag: '"d2"' }) });
  const gateway = transport.gateway;
  await colourSave(
    'acme',
    TENANT,
    view,
  )(gateway, {
    changes: {},
    values: { ...colourValues(view), 'tokens.light': null },
    ifMatch: '"d1"',
  });
  await imageSave(
    'acme',
    TENANT,
    view,
  )(gateway, {
    changes: {},
    values: { ...imageValues(view), 'assets.logo': null },
    ifMatch: '"d1"',
  });
  await templateSave(
    'acme',
    TENANT,
    view,
  )(gateway, {
    changes: {},
    values: { ...templateValues(view), 'templates.notice': '{{message}}' },
    ifMatch: '"d1"',
  });
  const [colours, images, templates] = sent.map((s) => s.body as Record<string, unknown>);
  expect(colours).toMatchObject({ tokens: {} });
  expect(Object.keys(colours?.assets ?? {})).toEqual(['logo']);
  expect(images).toMatchObject({ assets: {} });
  expect(Object.keys(images?.tokens ?? {})).toEqual(['light']);
  expect(templates).toMatchObject({ templates: { notice: '{{message}}' } });
});

it('sends a first save with no If-Match', async () => {
  const { transport, sent } = fakeTransport({ [`PUT ${TH}`]: json(view, 200, { etag: '"d1"' }) });
  await colourSave(
    'acme',
    TENANT,
    view,
  )(transport.gateway, {
    changes: {},
    values: colourValues(view),
    ifMatch: NO_DRAFT_TAG,
  });
  expect(sent[0]?.ifMatch).toBeNull();
});
