/**
 * How long a public client that registered itself, without anybody approving
 * it, signing in through it or holding a grant of it, is kept before
 * `odudu reap` removes it. An agent registers and sends the person to sign in
 * within minutes, so a week is generous.
 */
export const UNUSED_DYNAMIC_CLIENT_SECONDS = 7 * 24 * 60 * 60;
