import { Button } from '#/shared/ui/Button';
import { useAssistantTaskButton } from '#/features/assistant-actions/use-cases/useAssistantTaskButton';
import type { TaskId } from '#/features/assistant-actions/services/tasks';
import styles from '#/features/assistant-actions/ui/AssistantTaskButton/AssistantTaskButton.module.css';

// A screen's way into the assistant for the one thing it is good at there. It
// is drawn only where the assistant is offered, and opens the panel with the
// task chosen and its question ready in the field; the person sends it.
export function AssistantTaskButton({ tenant, task }: { tenant: string; task: TaskId }) {
  const button = useAssistantTaskButton(tenant, task);
  if (!button.shown) return null;
  return (
    <Button variant="secondary" onPress={button.press}>
      <svg className={styles.mark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4z" />
      </svg>
      {button.task.button}
    </Button>
  );
}
