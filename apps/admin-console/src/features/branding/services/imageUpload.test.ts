import type { SlotImage } from '#/features/branding/types/slotImage';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  imageAfterUpload,
  uploadFailureOf,
  IDLE_SLOTS,
  slotAfterUpload,
  uploadedImage,
  forgetImage,
  finishUpload,
  startUpload,
  editAlt,
  type SlotStates,
  type UploadStart,
} from '#/features/branding/services/imageUpload';
import type { ImageValues } from '#/features/branding/services/imageValues';
import type { GatewayResult } from '#/shared/services/result';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};

const asset = { id: 'a1', kind: 'logo' } as SlotImage;

const uploaded: GatewayResult<SlotImage> = {
  ok: true,
  status: 201,
  data: asset,
  etag: null,
  next: null,
};

const refused: GatewayResult<SlotImage> = {
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank#asset-animated', title: 't', status: 422 },
};

function slotsFrom(show: Mock<UploadStart['show']>, was: SlotStates): SlotStates {
  const next = show.mock.calls[0]?.[0];
  if (next === undefined) throw new Error('nothing was shown');
  return next(was);
}

describe('a lost upload', () => {
  it('distinguishes a lost answer from the console’s own fault', () => {
    expect(uploadFailureOf('logo', { ok: false, kind: 'network' })).toMatch(/Could not confirm/u);
    expect(uploadFailureOf('logo', { ok: false, kind: 'defect' })).toMatch(/fault in the console/u);
  });
});

describe('a logo’s alt text on upload', () => {
  it('start without alt text on first upload and keep it on replacement', () => {
    expect(imageAfterUpload('logo', 'a', none)).toEqual({ assetId: 'a', alt: '' });
    const had = { ...none, 'assets.logo': { assetId: 'old', alt: 'Acme' } };
    expect(imageAfterUpload('logo', 'new', had)).toEqual({ assetId: 'new', alt: 'Acme' });
    expect(imageAfterUpload('favicon', 'f', had)).toEqual({ assetId: 'f' });
  });
});

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
