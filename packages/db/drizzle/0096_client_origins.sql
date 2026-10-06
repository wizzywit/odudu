-- The origins a client allows, one row each, in the form they are compared in
-- (scheme and host lower-cased, a default port dropped): what a CORS
-- preflight asks of a tenant, "does an enabled client allow this origin",
-- which a client's own `web_origins` and the origins of its redirect URIs
-- could only answer by reading every client of the tenant. The database keeps
-- the rows current, whoever writes the lists they derive from.
CREATE TABLE client_origins (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  origin    text NOT NULL,
  PRIMARY KEY (client_id, origin),
  CONSTRAINT client_origins_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX client_origins_by_origin ON client_origins (tenant_id, origin, client_id);

ALTER TABLE client_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_origins FORCE ROW LEVEL SECURITY;

CREATE POLICY client_origins_isolation ON client_origins
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The origin of an http(s) URI as the server compares origins
-- (packages/protocol-oidc/src/service/web-origin.ts); null for anything else.
CREATE FUNCTION client_origin_of(uri text) RETURNS text
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
                   '^(https?)://(?:[^/?#@]*@)?([^/?#:@]+|\[[^\]]+\])(?::([0-9]+))?(?:[/?#]|$)',
                   'i') AS m) parsed
   WHERE m IS NOT NULL
$$;

CREATE FUNCTION client_origins_of(web_origins text[], redirect_uris text[]) RETURNS SETOF text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT client_origin_of(entry) FROM unnest(web_origins) entry
   WHERE entry <> '+' AND client_origin_of(entry) IS NOT NULL
  UNION
  SELECT client_origin_of(uri) FROM unnest(redirect_uris) uri
   WHERE '+' = ANY (web_origins) AND client_origin_of(uri) IS NOT NULL
$$;

CREATE FUNCTION client_origins_sync() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM client_origins WHERE client_id = NEW.client_id;
  INSERT INTO client_origins (tenant_id, client_id, origin)
  SELECT NEW.tenant_id, NEW.client_id, o FROM client_origins_of(NEW.web_origins, NEW.redirect_uris) o;
  RETURN NULL;
END
$$;

CREATE TRIGGER client_origins_sync
  AFTER INSERT OR UPDATE OF web_origins, redirect_uris ON client_oidc_config
  FOR EACH ROW EXECUTE FUNCTION client_origins_sync();

INSERT INTO client_origins (tenant_id, client_id, origin)
SELECT c.tenant_id, c.client_id, o
  FROM client_oidc_config c
 CROSS JOIN LATERAL client_origins_of(c.web_origins, c.redirect_uris) o;
