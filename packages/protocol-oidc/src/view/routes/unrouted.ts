import { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { wantsHtmlPage, isApiPath } from '#/service/page-negotiation';
import { sendHtml } from '#/view/html-response';
import { requestLocale } from '#/view/routes/continuation';
import { renderNotFoundPage, type NotFoundLinks } from '#/view/not-found-html';
import { renderServerErrorPage } from '#/view/server-error-html';

export interface UnroutedDeps {
  readonly links: NotFoundLinks;
}

// A request id the client chose arrives through `x-request-id`, so only one
// that is safe to print is shown; the response header carries it either way.
const SHOWABLE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

// The page depends on Accept, the language and the theme cookie; the problem
// document on a negotiable path depends on Accept alone. A cache that stored
// either is told which request headers chose it.
const VARY_PAGE = 'Accept, Accept-Language, Cookie';
const VARY_PROBLEM = 'Accept';

function negotiated(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  if (isApiPath(request.url)) return reply;
  return reply.header('vary', VARY_PROBLEM).header('cache-control', 'no-store');
}

function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  body: { type: string; title: string; status: number; detail?: string },
): FastifyReply {
  return negotiated(reply, request)
    .code(body.status)
    .header('content-type', 'application/problem+json')
    .send({ ...body, instance: request.id });
}

// Every path no route claims. An admin or protocol client gets RFC 9457's
// document, as does anything that is not a browser asking for a page.
export function answerNotFound(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: UnroutedDeps,
): FastifyReply {
  if (wantsHtmlPage(request.method, request.url, request.headers.accept)) {
    try {
      return sendHtml(
        reply.header('vary', VARY_PAGE),
        404,
        renderNotFoundPage(deps.links, requestLocale(reply)),
      );
    } catch {
      // A page that cannot be drawn is still a 404: the problem document below.
    }
  }
  return sendProblem(reply, request, {
    type: 'about:blank#not-found',
    title: 'Not Found',
    status: 404,
    detail: 'No resource at this path',
  });
}

// A database driver's error, or one wrapping it: the message carries the query
// and its parameters, and the stack begins with that message.
function involvesDriver(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('severity' in error || 'routine' in error) return true;
  if ('name' in error && (error.name === 'PostgresError' || error.name === 'DrizzleQueryError')) {
    return true;
  }
  return 'cause' in error && involvesDriver(error.cause);
}

// The root error handler. Every failure of status 500 or above answers 500,
// whatever status it carried. A server error is a fixed document and never
// sends the message. A client error keeps the framework's own answer.
export function answerServerError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const status = error.statusCode ?? 500;
  if (status < 500) return reply.send(error);
  // The logger's error serializer writes the kind, message and stack frames.
  // A driver's error is cut down to kind and code by hand first.
  const err = involvesDriver(error) ? { type: error.name, code: error.code } : error;
  request.log.error({ err }, 'request failed');
  if (wantsHtmlPage(request.method, request.url, request.headers.accept)) {
    const id = SHOWABLE_ID.test(request.id) ? request.id : null;
    try {
      return sendHtml(
        reply.header('vary', VARY_PAGE),
        500,
        renderServerErrorPage(id, requestLocale(reply)),
      );
    } catch {
      // The renderer failed: answer with the fixed document, never the message.
    }
  }
  return sendProblem(reply, request, {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
  });
}
