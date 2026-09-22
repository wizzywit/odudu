-- Whether this login asked to be remembered. It selects which of the two
-- lifespan pairs the session is measured against, and which cookie carries
-- its id, so it is a property of the login rather than of the browser.
ALTER TABLE sessions ADD COLUMN remembered boolean NOT NULL DEFAULT false;

-- How many live sessions one browser may hold. A login at the cap evicts
-- the least recently active session rather than being refused: a login that
-- fails because of an invisible cookie limit is indistinguishable, to the
-- person in front of it, from a broken server. 25 is the default measured
-- by the cookie-size spike (docs/superpowers/p3b-spike-cookies.md): the
-- observed per-cookie ceiling was 110 session ids before Chrome silently
-- dropped the cookie, and 25 leaves over 4x headroom under that.
ALTER TABLE realms ADD COLUMN max_sessions_per_browser integer NOT NULL DEFAULT 25;

ALTER TABLE realms ADD CONSTRAINT realms_max_sessions_per_browser_range
  CHECK (max_sessions_per_browser BETWEEN 1 AND 32);
