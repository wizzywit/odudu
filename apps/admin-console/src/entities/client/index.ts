export type { Client, ClientScopeAssignment, ClientType } from '#/entities/client/types/client';
export { ClientPicker } from '#/entities/client/ui/ClientPicker';
export { useClientPicker } from '#/entities/client/use-cases/clientPicker';
export {
  clientHref,
  clientsHref,
  clientsTrail,
  newClientHref,
} from '#/entities/client/services/clientAddress';
