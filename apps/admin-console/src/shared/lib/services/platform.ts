export type Platform = 'mac' | 'other';

// The parts of navigator read here; userAgentData is not in every browser.
export interface NavigatorLike {
  platform?: string;
  userAgentData?: { platform?: string };
}

const APPLE = /mac|iphone|ipad|ipod|ios/iu;

export function platformOf(navigator: NavigatorLike | undefined): Platform {
  const name = navigator?.userAgentData?.platform ?? navigator?.platform ?? '';
  return APPLE.test(name) ? 'mac' : 'other';
}

// Read once: the platform does not change under a page.
export const PLATFORM: Platform = platformOf(
  typeof navigator === 'undefined' ? undefined : navigator,
);

export type Key = 'Enter' | 'Mod' | 'Alt' | (string & {});

export interface KeyLabel {
  shown: string;
  spoken: string;
}

const NAMED: Readonly<Record<string, Readonly<Record<Platform, KeyLabel>>>> = {
  Enter: {
    mac: { shown: '↩ Return', spoken: 'Return' },
    other: { shown: '↵ Enter', spoken: 'Enter' },
  },
  Mod: { mac: { shown: '⌘', spoken: 'Command' }, other: { shown: 'Ctrl', spoken: 'Ctrl' } },
  Alt: { mac: { shown: '⌥', spoken: 'Option' }, other: { shown: 'Alt', spoken: 'Alt' } },
};

export function keyLabel(key: Key, platform: Platform): KeyLabel {
  return NAMED[key]?.[platform] ?? { shown: key, spoken: key };
}
