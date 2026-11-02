import { createSessionEvents, type SessionEvents } from '#/shared/services/sessionEvents';
import { createAuth, type Auth } from '#/shared/transport/auth';
import { createGateway, type Gateway } from '#/shared/transport/gateway';

// Everything that leaves the page: the gateway, the logout beside it, the
// event a refused session raises, and a navigation of the window itself
// (sign-in and the end-session redirect are pages, not requests).
export interface Transport {
  gateway: Gateway;
  auth: Auth;
  events: SessionEvents;
  leavePage: (url: string) => void;
}

export function createBrowserTransport(): Transport {
  const events = createSessionEvents();
  return {
    gateway: createGateway({ events }),
    auth: createAuth(),
    events,
    leavePage: (url) => {
      window.location.assign(url);
    },
  };
}
