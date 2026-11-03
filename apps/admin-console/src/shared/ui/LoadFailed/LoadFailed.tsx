import { Button } from '#/shared/ui/Button';
import { EmptyState } from '#/shared/ui/EmptyState';

// What a read that failed says, wherever it was made: the gateway did not
// answer, with a way to ask again. `unchanged` adds that the page wrote nothing.
export function LoadFailed({
  title,
  retry,
  unchanged = false,
}: {
  title: string;
  retry: () => void;
  unchanged?: boolean;
}) {
  return (
    <EmptyState variant="failed" title={title} action={<Button onPress={retry}>Try again</Button>}>
      {`The gateway did not answer, or answered with an error.${unchanged ? ' Nothing was changed.' : ''}`}
    </EmptyState>
  );
}
