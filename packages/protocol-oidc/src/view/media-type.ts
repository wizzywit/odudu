import { type FastifyRequest } from 'fastify';
import { carriesUnsupportedRepresentation } from '#/service/media-type';

// The three headers that between them say what representation a request
// carries, read once so `/authorize` and `/userinfo` apply the same rule to
// the same inputs rather than each deciding what a missing header means.
export function namesUnsupportedRepresentation(request: Pick<FastifyRequest, 'headers'>): boolean {
  return carriesUnsupportedRepresentation({
    contentType: request.headers['content-type'],
    contentLength: request.headers['content-length'],
    transferEncoding: request.headers['transfer-encoding'],
  });
}
