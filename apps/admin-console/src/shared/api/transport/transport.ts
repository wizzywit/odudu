import { createAuthEvents, type AuthEvents } from '#/shared/lib/services/authEvents';
import { createAuth, type Auth } from '#/shared/api/transport/auth';
import { createGateway, type Gateway } from '#/shared/api/transport/gateway';

// Everything that leaves the page: the gateway, the logout beside it, the
// event a refused session raises, and a navigation of the window itself
// (sign-in and the end-session redirect are pages, not requests).
export interface Transport {
  gateway: Gateway;
  auth: Auth;
  events: AuthEvents;
  leavePage: (url: string) => void;
}

export function createBrowserTransport(): Transport {
  const events = createAuthEvents();
  return {
    gateway: createGateway({ events }),
    auth: createAuth(),
    events,
    leavePage: (url) => {
      window.location.assign(url);
    },
  };
}
