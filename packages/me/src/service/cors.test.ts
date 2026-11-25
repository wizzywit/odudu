import { describe, expect, it } from 'vitest';
import { mePreflightHeaders } from '#/service/cors';

describe('the answer to a preflight', () => {
  it('echoes the origin and offers the methods and headers the routes take', () => {
    expect(mePreflightHeaders('https://spa.example')).toEqual({
      'access-control-allow-origin': 'https://spa.example',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
  });
});
