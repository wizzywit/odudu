-- Which executions this authentication has already satisfied. A multi-step
-- login has to resume rather than restart: a correct password followed by a
-- wrong OTP code must not ask for the password again.
ALTER TABLE authentication_sessions
  ADD COLUMN satisfied text[] NOT NULL DEFAULT '{}';
