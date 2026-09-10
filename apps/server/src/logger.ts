import { type Config } from '@odudu/kernel';
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';

export function createLogger(config: Config, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level: config.ODUDU_LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request: { method: string; url: string; headers: unknown; id: string }) => ({
          id: request.id,
          method: request.method,
          url: request.url,
          headers: request.headers,
        }),
      },
    },
    destination,
  );
}
