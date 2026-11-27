import { mayUseAssistant, askAssistant, useAssistantStatus } from '#/entities/assistant';
import { useAuthority } from '#/entities/session';
import {
  ASSISTANT_TASKS,
  type AssistantTask,
  type TaskId,
} from '#/features/assistant-actions/services/tasks';

export interface AssistantTaskButtonState {
  // The assistant is offered here: nothing is drawn, and nothing is asked, otherwise.
  shown: boolean;
  task: AssistantTask;
  press: () => void;
}

// What a screen's assistant button needs: whether the assistant is offered to
// this caller in this tenant, and the call that puts the task in the panel.
export function useAssistantTaskButton(tenant: string, id: TaskId): AssistantTaskButtonState {
  const view = useAssistantStatus(tenant, mayUseAssistant(useAuthority(tenant)));
  const task = ASSISTANT_TASKS[id];
  return {
    shown: view.enabled,
    task,
    press: () => {
      askAssistant({ tenant, profile: task.id, draft: task.starter });
    },
  };
}
