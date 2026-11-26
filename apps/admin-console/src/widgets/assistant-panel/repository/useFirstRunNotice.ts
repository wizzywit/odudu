import { useState } from 'react';
import { noticeWasRead, rememberNoticeRead } from '#/widgets/assistant-panel/adapter/noticeStorage';

// Whether the notice about where the conversation goes is still to be read.
// It is read once per browser: dismissing it is remembered where the browser
// lets it be, and is true for this page either way.
export function useFirstRunNotice(): { unread: boolean; dismiss: () => void } {
  const [unread, setUnread] = useState(() => !noticeWasRead());
  return {
    unread,
    dismiss: () => {
      rememberNoticeRead();
      setUnread(false);
    },
  };
}
