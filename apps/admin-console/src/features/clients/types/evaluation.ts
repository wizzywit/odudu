// The claims each artefact would carry; `id_token` is null without `openid`.
export interface EvaluatedClaims {
  scope: string;
  id_token: Record<string, unknown> | null;
  access_token: Record<string, unknown>;
  userinfo: Record<string, unknown>;
}
