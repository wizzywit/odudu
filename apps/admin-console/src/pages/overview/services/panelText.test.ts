import { describe, expect, it } from 'vitest';
import {
  countAgainLabel,
  laneText,
  limitText,
  openPlaceLabel,
  UNCHECKED_LEAD,
  unreadableTitle,
} from '#/pages/overview/services/panelText';

describe('the words of the overview panels', () => {
  it('says the lane of a published key', () => {
    expect(laneText('unlisted')).toBe('not in the key list');
    expect(laneText('active')).toBe('active');
    expect(laneText('rotating')).toBe('rotating');
  });

  it('says what a failed read could not do', () => {
    expect(unreadableTitle('JWKS')).toBe('The JWKS could not be read');
  });

  it('says what the cap counts beside a count, with thousands grouped', () => {
    expect(limitText(200, { count: 1, capped: false })).toBe(
      ' (1 of 200 made by administrators or tokens)',
    );
    expect(limitText(12_000, { count: 1_500, capped: true })).toBe(
      ' (1,500+ of 12,000 made by administrators or tokens)',
    );
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
