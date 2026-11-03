export interface Installation {
  issuer: string;
  discovery_url: string;
  client_id: string;
  client_type: 'public' | 'confidential';
  token_endpoint_auth_method: string;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  grant_types: string[];
  default_scope: string;
}
