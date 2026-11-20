import { applyChange, setCookiesOf } from '#/adapter/responses';
import { cookieHeaderOf, returnToOf } from '#/adapter/requests';
import { planCallback, planLogin } from '#/services/return-plan';
import { returnTargetOf } from '#/services/return-cookie';
import type { HandlersConfig } from '#/services/config';

// What a sign-in keeps of the page the person was headed for, between the
// `login` request and the `callback` that brings them back.
export interface ReturnTrip {
  afterLogin(request: Request, response: Response): Response;
  afterCallback(request: Request, response: Response): Response;
}

export function createReturnTrip(config: HandlersConfig): ReturnTrip {
  return {
    afterLogin: (request, response) =>
      applyChange(
        response,
        planLogin(response.status, returnToOf(request), config.returnCookieName, config.mountPath),
      ),
    afterCallback: (request, response) => {
      const header = cookieHeaderOf(request);
      return applyChange(
        response,
        planCallback({
          status: response.status,
          setCookies: setCookiesOf(response),
          sessionCookieName: config.cookieName,
          returnCookieName: config.returnCookieName,
          target: returnTargetOf(header, config.returnCookieName, config.mountPath),
          carriedReturnCookie: header?.includes(`${config.returnCookieName}=`) === true,
        }),
      );
    },
  };
}
