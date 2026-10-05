import { describe, expect, it } from 'vitest';
import {
  countAgainLabel,
  laneText,
  limitText,
  openPlaceLabel,
  UNCHECKED_LEAD,
  unreadableTitle,
} from '#/features/overview/service/panelText.ts';

describe('the words of the overview panels', () => {
  it('says the lane of a published key', () => {
    expect(laneText('unlisted')).toBe('not in the key list');
    expect(laneText('active')).toBe('active');
    expect(laneText('rotating')).toBe('rotating');
  });

  it('says what a failed read could not do', () => {
    expect(unreadableTitle('JWKS')).toBe('The JWKS could not be read');
  });

  it('says the allowance beside a count, with thousands grouped', () => {
    expect(limitText(200)).toBe(' of 200 allowed');
    expect(limitText(12_000)).toBe(' of 12,000 allowed');
  });

  it('labels the button that counts again', () => {
    expect(countAgainLabel('clients')).toBe('Count clients again');
  });
});

describe('the words of the attention panel', () => {
  it('names the area a link opens', () => {
    expect(openPlaceLabel('Email')).toBe('Open Email');
  });

  it('leads the capabilities the checks needed', () => {
    expect(UNCHECKED_LEAD).toBe('Some checks need a capability you do not hold: ');
  });
});
