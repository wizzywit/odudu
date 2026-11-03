export type { Client, ClientScopeAssignment, ClientType } from '#/entities/client/types/client';
export { ClientPicker } from '#/entities/client/ui/ClientPicker';
export { readClientPage } from '#/entities/client/use-cases/clientCalls';
export { useClientPicker } from '#/entities/client/use-cases/clientPicker';
export {
  clientHref,
  clientsHref,
  clientsTrail,
  newClientHref,
} from '#/entities/client/services/clientAddress';
