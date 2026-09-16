// The registry keys #/usecase/executor dispatches on, and the `form` names
// a rendered page switches on — one vocabulary, because they are the same
// strings by design (see AuthenticatorResult's `form`). Shared so one
// authenticator's applicability can refer to another's key without
// repeating the literal: otpApplicable has to know what a passkey is called
// in order to stand down after one.
export const PASSWORD = 'password';
export const PASSKEY = 'passkey';
export const OTP = 'otp';
