CREATE FUNCTION web_origins_are_valid(origins text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT bool_and(o = '+' OR o ~ '^https?://[^/?#[:space:]*]+$')
  FROM unnest(origins) AS o
$$;

ALTER TABLE client_oidc_config
  ADD COLUMN web_origins text[] NOT NULL DEFAULT '{}';

ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_web_origins_shape
  CHECK (web_origins_are_valid(web_origins));
