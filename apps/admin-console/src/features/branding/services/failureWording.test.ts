import { describe, expect, it } from 'vitest';
import { uploadFailureOf } from '#/features/branding/services/imageUpload';
import type { GatewayFailure } from '#/shared/services/result';
import { failure, refusal } from '#/testing/failures';

describe('uploadFailureOf', () => {
  const cases: [string, GatewayFailure, string][] = [
    ['400', refusal(400, { detail: 'D400' }), 'The image was not uploaded.'],
    ['403', refusal(403), 'The image was not uploaded.'],
    ['404', refusal(404), 'The image was not uploaded.'],
    ['409', refusal(409, { detail: 'D409' }), 'The image was not uploaded.'],
    ['412', refusal(412), 'The image was not uploaded.'],
    ['413', refusal(413), 'The image is over 256 KiB for a logo, as uploaded or once stored.'],
    ['502', refusal(502, { detail: 'D502' }), 'The image was not uploaded.'],
    [
      'network',
      failure('network'),
      'Could not confirm that the image was uploaded. Check before trying again.',
    ],
    [
      'schema',
      failure('schema'),
      'The console could not upload the image. This is a fault in the console, not something you did.',
    ],
    [
      'defect',
      failure('defect'),
      'The console could not upload the image. This is a fault in the console, not something you did.',
    ],
    ['403 detail', refusal(403, { detail: 'D403' }), 'The image was not uploaded.'],
    ['400 title', refusal(400), 'The image was not uploaded.'],
    ['500 title', refusal(500), 'The image was not uploaded.'],
    [
      '400 too broad',
      refusal(400, { type: 'about:blank#audit-query-too-broad' }),
      'The image was not uploaded.',
    ],
  ];
  it.each(cases)('says the same for %s', (_label, failure, text) => {
    expect(uploadFailureOf('logo', failure)).toBe(text);
  });
});
