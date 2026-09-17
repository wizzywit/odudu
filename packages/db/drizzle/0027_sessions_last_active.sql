-- expires_at is the hard ceiling: created_at plus the realm's maximum
-- lifespan. last_active_at is the idle clock, touched on use. They are two
-- columns rather than one sliding expiry so that "idled out" and "hit its
-- ceiling" stay distinguishable after the fact, and so a session list has a
-- last-use time to show.
ALTER TABLE sessions ADD COLUMN last_active_at timestamptz;
UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();
