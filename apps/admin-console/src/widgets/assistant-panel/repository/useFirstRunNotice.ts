import { useState } from 'react';
import { noticeWasRead, rememberNoticeRead } from '#/widgets/assistant-panel/adapter/noticeStorage';
import type { NoticeScope } from '#/widgets/assistant-panel/types/firstRun';

// Whether the notice about where the conversation goes is still to be read.
// It is read once per browser, once for a conversation in the administrator's
// own tenant and once for one in another: dismissing it is remembered where
// the browser lets it be, and is true for this page either way.
export function useFirstRunNotice(scope: NoticeScope): { unread: boolean; dismiss: () => void } {
  const [unread, setUnread] = useState(() => !noticeWasRead(scope));
  return {
    unread,
    dismiss: () => {
      rememberNoticeRead(scope);
      setUnread(false);
    },
  };
}
