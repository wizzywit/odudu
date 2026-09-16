-- The random value a WebAuthn ceremony has to be answered with, parked on
-- the attempt rather than handed to the browser to give back: a challenge
-- the response carries is no challenge at all. Null except between the
-- moment options are issued and the moment a response is verified, and
-- cleared by the same statement that reads it, so replaying a response
-- finds nothing to match against.
ALTER TABLE authentication_sessions ADD COLUMN webauthn_challenge text;
