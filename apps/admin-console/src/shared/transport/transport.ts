import { sessionEvents, type SessionEvents } from '#/shared/service/sessionEvents.ts';
import { createAuth, type Auth } from '#/shared/transport/auth.ts';
import { createGateway, type Gateway } from '#/shared/transport/gateway.ts';

// Everything that leaves the page: the gateway, the logout beside it, the
// event a refused session raises, and a navigation of the window itself
// (sign-in and the end-session redirect are pages, not requests).
export interface Transport {
  readonly gateway: Gateway;
  readonly auth: Auth;
  readonly events: SessionEvents;
  readonly leavePage: (url: string) => void;
}

export function createBrowserTransport(): Transport {
  return {
    gateway: createGateway({ events: sessionEvents }),
    auth: createAuth(),
    events: sessionEvents,
    leavePage: (url) => {
      window.location.assign(url);
    },
  };
}
