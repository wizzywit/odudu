// The rules a framework binding (such as `@odudu-io/next`) shares with the BFF,
// so that it does not keep copies that could drift: the cookie, the session id
// and the store key it is kept under, the custom header, the paths it may
// mount on or send a person to, and when a session is over. Apps do not need
// this entry.
export { BFF_HEADER, DEFAULT_COOKIE_NAME, checkMountPath, isLocalPath } from '#/services/config';
export { clearCookie, readCookie, setCookie } from '#/services/cookies';
export { isSessionId, sessionKey } from '#/services/session-id';
export { isExpiredForGood } from '#/services/session-policy';
