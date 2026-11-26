// What the person is told before the first message.
export interface FirstRunNotice {
  sentTo: string;
  seenBy: string;
  // Who pays and who sees what, for an administrator acting in another
  // tenant; null in the administrator's own.
  acting: string | null;
}

// A conversation in another tenant is a different thing to have read about,
// so its notice is remembered apart.
export type NoticeScope = 'own' | 'other-tenant';
