import type { RouteId } from '@site/src/features/landing/services/sceneLayouts';

// The sign-in scene's story: its eight steps, what is active in each, and
// what each beat says.

export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Activity {
  device: boolean;
  hub: boolean;
  appA: boolean;
  appB: boolean;
  routes: RouteId[];
  pass: 'a' | 'b' | null;
  chips: boolean;
  pulse: boolean;
  bArrived: boolean;
}

const NONE: Activity = {
  device: false,
  hub: false,
  appA: false,
  appB: false,
  routes: [],
  pass: null,
  chips: false,
  pulse: false,
  bArrived: true,
};

// Step 0 is the composed picture at rest: nothing moving, everything in place.
export const ACTIVITY: Record<Step, Activity> = {
  0: NONE,
  1: { ...NONE, device: true, appA: true, routes: ['da'], bArrived: false },
  2: { ...NONE, device: true, hub: true, routes: ['dh'], bArrived: false },
  3: { ...NONE, hub: true, chips: true, pulse: true, bArrived: false },
  4: { ...NONE, hub: true, appA: true, routes: ['ha'], pass: 'a', bArrived: false },
  5: { ...NONE, device: true, appB: true, routes: ['db'] },
  6: { ...NONE, hub: true, appB: true, routes: ['bh', 'hb'], pass: 'b', pulse: true },
  7: { ...NONE, hub: true, appA: true, appB: true, routes: ['ha', 'hb'] },
};

export interface Beat {
  label: string;
  // The label as shown on one line in the stepper; the full label stays the accessible name.
  short: string;
  caption: string;
  ms: number;
  claims: string[];
}

export const BEATS: Beat[] = [
  {
    label: 'Open the app',
    short: 'Open the app',
    caption: 'A person opens your app.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Go to Odudu',
    short: 'Go to Odudu',
    caption: 'Your app sends them to Odudu to sign in.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Sign in once',
    short: 'Sign in once',
    caption:
      "They sign in on Odudu's own page. Odudu supports passwords, passkeys and codes from an authenticator app.",
    ms: 3000,
    claims: ['passwords', 'passkeys', 'authenticator-codes'],
  },
  {
    label: 'Back with a signed pass',
    short: 'Signed pass',
    caption: 'Odudu sends them back with a signed pass, and your app lets them in.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Open a second app',
    short: 'Second app',
    caption: 'Later, they open a second app, and it sends them to Odudu too.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Already signed in',
    short: 'Signed in',
    caption:
      'Odudu sees they are already signed in, so it shows no sign-in page. Straight back, with no password asked. Sign in once, and use every app of that tenant that trusts Odudu.',
    ms: 3400,
    claims: ['single-sign-on'],
  },
  {
    label: 'Signed out where registered',
    short: 'Signed out',
    caption: 'Sign out of one, and the apps that registered for it are told.',
    ms: 2500,
    claims: ['back-channel-logout'],
  },
];

const CLAIM_TEXT: Record<string, string> = {
  passwords: 'Passwords',
  passkeys: 'Passkeys',
  'authenticator-codes': 'Authenticator codes',
  'single-sign-on': 'Single sign-on across one tenant',
  'back-channel-logout': 'Back-channel logout',
};

// The words for a capability the scene names; the capability is its own text if unknown.
export function claimText(claim: string): string {
  return CLAIM_TEXT[claim] ?? claim;
}
