import { browserStorage } from '#/shared/api/adapter/browserStorage';

const KEY = 'odudu.console.assistant.notice-read';

// Whether this browser has been shown the notice. A browser that cannot
// remember says it has not, so the notice is shown again rather than lost.
export function noticeWasRead(): boolean {
  try {
    return browserStorage('local')?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberNoticeRead(): void {
  try {
    browserStorage('local')?.setItem(KEY, '1');
  } catch {
    // Unremembered, the notice is gone for this page and comes back next time.
  }
}
