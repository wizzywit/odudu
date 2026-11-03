import type { Client } from '#/entities/client';

// One client's own read and amendment add the languages its tenant offers.
export interface ClientRecord extends Client {
  supported_locales: string[];
}

// Carried only in the creation answer, and only for a client that has one.
export interface CreatedClient extends Client {
  client_secret?: string | undefined;
}

export interface RotatedSecret extends Client {
  client_secret: string;
}
