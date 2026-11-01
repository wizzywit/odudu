import type { ThemeAsset } from '@odudu/contracts/admin';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  altChanged,
  announcePublish,
  changedColours,
  contrastReport,
  DEFAULT_PALETTES,
  IDLE_SLOTS,
  NO_OUTCOME,
  publishOutcomeOf,
  publishDefected,
  currentOutcome,
  selectOffered,
  slotAfterUpload,
  slotNames,
  slotView,
  unsavedSections,
  uploadedImage,
  forgetImage,
  finishUpload,
  startUpload,
  editAlt,
  type ImageValues,
  type SlotStates,
  type UploadStart,
} from '#/features/branding/service';
import type { GatewayResult } from '#/shared/service/result';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};
const asset = { id: 'a1', kind: 'logo' } as ThemeAsset;
const uploaded: GatewayResult<ThemeAsset> = {
  ok: true,
  status: 201,
  data: asset,
  etag: null,
  next: null,
};
const refused: GatewayResult<ThemeAsset> = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank#asset-animated', title: 't', status: 422 },
};

function slotsFrom(show: Mock<UploadStart['show']>, was: SlotStates): SlotStates {
  const next = show.mock.calls[0]?.[0];
  if (next === undefined) throw new Error('nothing was shown');
  return next(was);
}

describe('an upload', () => {
  it('starts busy when the file may be sent, and fails in place when it may not', () => {
    const shown = vi.fn<UploadStart['show']>();
    const send = vi.fn();
    startUpload('logo', { type: 'image/png', size: 10 }, { show: shown, send });
    expect(send).toHaveBeenCalledOnce();
    const busy = slotsFrom(shown, IDLE_SLOTS);
    expect(busy.logo).toEqual({ busy: true, error: null });

    const bigShown = vi.fn<UploadStart['show']>();
    const bigSend = vi.fn();
    startUpload('logo', { type: 'image/png', size: 10_000_000 }, { show: bigShown, send: bigSend });
    expect(bigSend).not.toHaveBeenCalled();
    const failed = slotsFrom(bigShown, IDLE_SLOTS);
    expect(failed.logo.busy).toBe(false);
    expect(failed.logo.error).toMatch(/over 256 KiB/u);
  });

  it('starts from the slots as they are when it runs, not as they were drawn', () => {
    const shown = vi.fn<UploadStart['show']>();
    startUpload('logo', { type: 'image/png', size: 10 }, { show: shown, send: vi.fn() });
    const otherBusy = { ...IDLE_SLOTS, favicon: { busy: true, error: null } };
    const next = slotsFrom(shown, otherBusy);
    expect(next.favicon.busy).toBe(true);
    expect(next.logo.busy).toBe(true);
  });

  it('settles its slot, fills it and reports, each only when it applies', () => {
    const to = { show: vi.fn(), edit: vi.fn(), report: vi.fn() };
    finishUpload('logo', uploaded, none, to);
    expect(to.show).toHaveBeenCalledOnce();
    expect(to.edit).toHaveBeenCalledExactlyOnceWith('logo', { assetId: 'a1', alt: '' });
    expect(to.report).not.toHaveBeenCalled();

    const again = { show: vi.fn(), edit: vi.fn(), report: vi.fn() };
    finishUpload('logo', refused, none, again);
    expect(again.show).toHaveBeenCalledOnce();
    expect(again.edit).not.toHaveBeenCalled();
    expect(again.report).toHaveBeenCalledOnce();
  });

  it('leaves its slot quiet when it landed, and says why when it was refused', () => {
    expect(slotAfterUpload(IDLE_SLOTS, 'logo', uploaded).logo).toEqual({
      busy: false,
      error: null,
    });
    expect(slotAfterUpload(IDLE_SLOTS, 'logo', refused).logo.error).toBe(
      'An animated image is not accepted.',
    );
  });

  it('fills its slot only when it landed, keeping a logo’s alt text', () => {
    const had = { ...none, 'assets.logo': { assetId: 'old', alt: 'Acme' } };
    expect(uploadedImage('logo', uploaded, had)).toEqual({ assetId: 'a1', alt: 'Acme' });
    expect(uploadedImage('logo', refused, had)).toBeNull();
  });
});

describe('a deleted image', () => {
  it('empties the slot only if the slot holds that very image', () => {
    const had = { ...none, 'assets.favicon': { assetId: 'f1' } };
    expect(slotNames(had, 'favicon', 'f1')).toBe(true);
    expect(slotNames(had, 'favicon', 'other')).toBe(false);
    expect(slotNames(had, 'logo', 'f1')).toBe(false);
  });
});

describe('a publish answer', () => {
  it('toasts only when it asks to', () => {
    const toast = vi.fn();
    announcePublish(NO_OUTCOME, toast);
    expect(toast).not.toHaveBeenCalled();
    announcePublish({ ...NO_OUTCOME, toast: 'Published.' }, toast);
    expect(toast).toHaveBeenCalledExactlyOnceWith('Published.');
  });
});

describe('an image edit that may not apply', () => {
  it('sets a logo’s alt text only where a logo is set', () => {
    const edit = vi.fn();
    editAlt(none, 'logo', 'x', edit);
    expect(edit).not.toHaveBeenCalled();
    const had = { ...none, 'assets.logo': { assetId: 'a', alt: 'A' } };
    editAlt(had, 'logo', 'x', edit);
    expect(edit).toHaveBeenCalledExactlyOnceWith('logo', { assetId: 'a', alt: 'x' });
  });

  it('empties the slot of a deleted image only if it holds that image', () => {
    const had = { ...none, 'assets.favicon': { assetId: 'f1' } };
    const edit = vi.fn();
    forgetImage(had, 'favicon', 'other', edit);
    expect(edit).not.toHaveBeenCalled();
    forgetImage(had, 'favicon', 'f1', edit);
    expect(edit).toHaveBeenCalledExactlyOnceWith('favicon', null);
  });
});

describe('what is marked changed', () => {
  it('is each colour that differs from the saved palette, none for a scheme left alone', () => {
    const now = { ...DEFAULT_PALETTES.light, inkPrimary: '#000000' };
    expect(changedColours(DEFAULT_PALETTES.light, now)).toEqual(['inkPrimary']);
    expect(changedColours(null, null)).toEqual([]);
    expect(changedColours(null, now)).toHaveLength(11);
  });

  it('is a logo’s alt text that differs from the saved one', () => {
    const saved = { ...none, 'assets.logo': { assetId: 'a', alt: 'A' } };
    const edited = { ...none, 'assets.logo': { assetId: 'a', alt: 'B' } };
    expect(altChanged(saved, edited, 'logo')).toBe(true);
    expect(altChanged(saved, saved, 'logo')).toBe(false);
    expect(altChanged(saved, saved, 'favicon')).toBe(false);
  });

  it('names the sections with unsaved edits, in the order they sit', () => {
    expect(unsavedSections(new Set(['templates', 'stylesheet', 'colours']))).toEqual([
      'Colours and font',
      'Stylesheet',
      'Page templates',
    ]);
    expect(unsavedSections(new Set())).toEqual([]);
  });
});

describe('the upload button’s name', () => {
  it('says it is uploading while it is', () => {
    expect(slotView('logo', none, true).uploadName).toBe('Uploading logo');
    expect(slotView('logo', none).uploadName).toBe('Upload logo');
  });
});

describe('the tabs', () => {
  it('select a tab this area has, and nothing for another name', () => {
    const select = vi.fn<(tab: string) => void>();
    selectOffered('pages', select);
    selectOffered('languages', select);
    selectOffered('nope', select);
    expect(select.mock.calls).toEqual([['pages'], ['languages']]);
  });
});

describe('a publish', () => {
  it('tells a send that threw as a defect, held at its draft', () => {
    const told = publishDefected((failure) => failure.kind, '"d1"');
    expect(told.message).toBe('defect');
    expect(told.atTag).toBe('"d1"');
    expect(told.toast).toBeNull();
  });

  it('toasts only when it went through', () => {
    const ok = publishOutcomeOf(
      {
        ok: true,
        status: 200,
        data: { ...({} as object), warnings: [] } as never,
        etag: null,
        next: null,
      },
      () => '',
      '"d1"',
    );
    expect(ok.toast).toBe('Theme published');
    expect(publishOutcomeOf({ ok: false, kind: 'network' }, () => 'lost', '"d1"').toast).toBeNull();
    expect(NO_OUTCOME.toast).toBeNull();
  });

  it('keeps a refusal’s errors with the draft it was given for', () => {
    const errors = [{ path: 'stylesheet', message: 'm', line: 3 }];
    const refused = publishOutcomeOf(
      {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Bad', status: 400, errors },
      },
      () => 'no',
      '"d1"',
    );
    expect(refused).toMatchObject({ errors, atTag: '"d1"', message: 'no' });
    expect(NO_OUTCOME).toMatchObject({ errors: [], atTag: null });
  });

  it('shows a refusal only for the draft it was given for', () => {
    const refused = publishOutcomeOf(
      { ok: false, kind: 'problem', problem: { type: 'about:blank', title: 'Bad', status: 400 } },
      () => 'no',
      '"d1"',
    );
    expect(currentOutcome(refused, '"d1"')).toBe(refused);
    expect(currentOutcome(refused, '"d2"')).toBe(NO_OUTCOME);
    const lost = publishOutcomeOf({ ok: false, kind: 'network' }, () => 'lost', '"d1"');
    expect(currentOutcome(lost, '"d2"')).toBe(NO_OUTCOME);
    const ok = publishOutcomeOf(
      { ok: true, status: 200, data: { warnings: [] } as never, etag: null, next: null },
      () => '',
      '"d1"',
    );
    expect(currentOutcome(ok, '"d2"')).toBe(ok);
  });

  it('tells a screen reader only whether the contrast passes', () => {
    const values = {
      'tokens.light': DEFAULT_PALETTES.light,
      'tokens.dark': null,
      'tokens.font': null,
    };
    expect(contrastReport(values).verdict).toBe('Contrast passes.');
    const worse = {
      ...values,
      'tokens.light': { ...DEFAULT_PALETTES.light, inkPrimary: '#e8e8e8' },
    };
    expect(contrastReport(worse).verdict).toMatch(/^Contrast fails/u);
  });
});
