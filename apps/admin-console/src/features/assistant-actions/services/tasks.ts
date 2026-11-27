// The kinds of conversation the console starts for a person, one per screen's
// button. The ids are the server's profile ids.
export const FREE_CHAT_PROFILE = 'free-chat';

export type TaskId = 'why-cant-sign-in' | 'review-client';

export interface AssistantTask {
  id: TaskId;
  // What the task is called wherever it is named: the panel's chip.
  title: string;
  // The button on the page.
  button: string;
  // The message put in the field. It names no record: where the person is
  // goes with it as the page context, so nothing a record holds is typed for them.
  starter: string;
}

export const ASSISTANT_TASKS: Readonly<Record<TaskId, AssistantTask>> = {
  'why-cant-sign-in': {
    id: 'why-cant-sign-in',
    title: 'Why can’t this person sign in?',
    button: 'Why can’t they sign in?',
    starter: 'Why can’t this person sign in?',
  },
  'review-client': {
    id: 'review-client',
    title: 'Review this client',
    button: 'Review with the assistant',
    starter: 'Review how this client is set up.',
  },
};

function taskOf(profile: string): AssistantTask | undefined {
  return Object.values(ASSISTANT_TASKS).find((task) => task.id === profile);
}

// The task's name for a conversation's profile, or null for free chat.
export function taskTitleOf(profile: string): string | null {
  return taskOf(profile)?.title ?? null;
}

// Every task here reads and explains: Act is not offered for a conversation of one.
export function isReadTask(profile: string): boolean {
  return taskOf(profile) !== undefined;
}
