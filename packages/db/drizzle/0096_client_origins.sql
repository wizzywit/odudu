-- The origins a client allows, one row each, in the form they are compared in
-- (scheme and host lower-cased, a default port dropped): what a CORS
-- preflight asks of a tenant, "does an enabled client allow this origin",
-- which a client's own `web_origins` and the origins of its redirect URIs
-- could only answer by reading every client of the tenant. The server writes
-- the rows with the one normaliser the request side uses
-- (packages/protocol-oidc/src/service/web-origin.ts) whenever it writes the
-- lists they derive from.
CREATE TABLE client_origins (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  origin    text NOT NULL,
  PRIMARY KEY (client_id, origin),
  CONSTRAINT client_origins_config_fk FOREIGN KEY (client_id)
    REFERENCES client_oidc_config (client_id) ON DELETE CASCADE
);

CREATE INDEX client_origins_by_origin ON client_origins (tenant_id, origin, client_id);

-- The origin of an http(s) URI when it is already in the form the URL parser
-- gives, and null for everything else: an internationalised host, a port with
-- a leading zero or over 65535, a numeric shorthand host, an IPv6 literal,
-- userinfo, a backslash. The parser would rewrite or reject those, SQL cannot
-- follow it, so it declines them and the origin is simply not allowed until
-- the server rewrites the row.
CREATE FUNCTION client_origin_if_canonical(uri text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT lower(m[1]) || '://' || lower(m[2])
         || CASE
              WHEN m[3] IS NULL
                OR (lower(m[1]) = 'http' AND m[3] = '80')
                OR (lower(m[1]) = 'https' AND m[3] = '443') THEN ''
              ELSE ':' || m[3]
            END
    FROM (SELECT regexp_match(
                   uri,
                   '^(https?)://([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?::([1-9][0-9]{0,4}))?(?:[/?#]|$)',
                   'i') AS m) parsed
   WHERE m IS NOT NULL
     AND (m[3] IS NULL OR m[3]::integer <= 65535)
     AND (lower(m[2]) !~ '(^|[.])(0x[0-9a-f]*|[0-9]+)$'
          OR lower(m[2]) ~ '^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])([.](25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$')
$$;

-- Existing clients. `client_oidc_config` carries FORCE ROW LEVEL SECURITY, so
-- an owner that is neither SUPERUSER nor BYPASSRLS reads no row of it here
-- and nothing is raised: lifted for the read and restored after it, as
-- 0040_recovery_code_execution.sql does and gives the reasons for. A value the
-- function declines gets no row until the client is amended or `odudu
-- client-origins rebuild` runs, which writes every client's rows with the server's
-- own normaliser.
ALTER TABLE client_oidc_config NO FORCE ROW LEVEL SECURITY;

INSERT INTO client_origins (tenant_id, client_id, origin)
SELECT c.tenant_id, c.client_id, o.origin
  FROM client_oidc_config c
 CROSS JOIN LATERAL (
   SELECT client_origin_if_canonical(entry) AS origin
     FROM unnest(c.web_origins) entry WHERE entry <> '+'
   UNION
   SELECT client_origin_if_canonical(uri)
     FROM unnest(c.redirect_uris) uri WHERE '+' = ANY (c.web_origins)
 ) o
 WHERE o.origin IS NOT NULL;

ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;

-- A change to the lists made any way but through the server empties the
-- client's origins, so a stale origin is never left allowed: the server
-- writes them again, in the same transaction, after its own update.
CREATE FUNCTION client_origins_clear() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM client_origins WHERE client_id = NEW.client_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER client_origins_clear
  AFTER UPDATE OF web_origins, redirect_uris ON client_oidc_config
  FOR EACH ROW EXECUTE FUNCTION client_origins_clear();

ALTER TABLE client_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_origins FORCE ROW LEVEL SECURITY;

CREATE POLICY client_origins_isolation ON client_origins
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
