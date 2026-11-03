export interface Tenant {
  name: string;
  // Null where the tenant has no display name; the server keeps no empty one.
  displayName: string | null;
  enabled: boolean;
  createdAt: string;
}
