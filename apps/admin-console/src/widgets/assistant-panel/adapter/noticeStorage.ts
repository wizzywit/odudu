import type { NoticeScope } from '#/widgets/assistant-panel/types/firstRun';
import { browserStorage } from '#/shared/api/adapter/browserStorage';

const KEYS: Readonly<Record<NoticeScope, string>> = {
  own: 'odudu.console.assistant.notice-read',
  'other-tenant': 'odudu.console.assistant.notice-read-other-tenant',
};

// Whether this browser has been shown the notice. A browser that cannot
// remember says it has not, so the notice is shown again rather than lost.
export function noticeWasRead(scope: NoticeScope = 'own'): boolean {
  try {
    return browserStorage('local')?.getItem(KEYS[scope]) === '1';
  } catch {
    return false;
  }
}

export function rememberNoticeRead(scope: NoticeScope = 'own'): void {
  try {
    browserStorage('local')?.setItem(KEYS[scope], '1');
  } catch {
    // Unremembered, the notice is gone for this page and comes back next time.
  }
}
