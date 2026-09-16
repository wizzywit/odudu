-- Mail leaves the request path entirely: the request enqueues a row in the
-- transaction that mints the token, answers, and a scheduled sender does
-- the SMTP round trip. That is what closes the password-reset timing
-- oracle, where an address that existed was measurably slower to answer
-- than one that did not.
--
-- Two bodies rather than the one, because EmailMessage carries both
-- (packages/email/src/service/sender.ts) and a queue that stored one would
-- decide for every template that mail is text-only or HTML-only.
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_isolation ON email_outbox
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- Leading with realm_id the way every other index in this schema does: the
-- sender claims under one realm's policy at a time, so a scan that ignores
-- realm_id would read every tenant's queue to answer for one.
CREATE INDEX email_outbox_pending ON email_outbox (realm_id, next_attempt_at)
  WHERE sent_at IS NULL;

-- The retention scan (apps/server/src/cli/reap.ts): a delivered message
-- past its window, and one that has spent its attempts and been visible to
-- an operator for its own longer window.
CREATE INDEX email_outbox_by_sent ON email_outbox (realm_id, sent_at);
