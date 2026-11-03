export const REDIRECTS_RULE =
  'Where sign-in may send the browser back: an https address, an http address on this machine, or an application scheme such as com.example.app:/cb. A request must name one exactly; no other is followed.';

export const ORIGINS_RULE =
  "The origins a browser may call this client's endpoints from. An origin is a scheme and host with no path, such as https://app.example. Use + to allow the origin of every redirect URI above.";

export const PAGES_RULE =
  'Linked from the consent screen: an https address, or an http address on this machine. Leave one empty for none.';

export const POST_LOGOUT_NOTE =
  'Where a sign-out may send the browser back is set apart from these, under Logout.';

const REGISTERED: Readonly<Record<string, string>> = {
  seeded: 'Seeded from the command line',
  operator: 'Created by an administrator',
  anonymous: 'Registered dynamically, with no token',
  token: 'Registered dynamically, with a registration token',
};

export function registeredText(origin: string): string {
  return REGISTERED[origin] ?? origin;
}
