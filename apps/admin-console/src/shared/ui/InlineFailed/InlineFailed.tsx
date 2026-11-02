import { Button } from '#/shared/ui/Button';

// A read that failed inside something smaller than a page, a tree level or a
// picker: one line saying so, and a small way to ask again. Each caller's
// sheet lays it out.
export function InlineFailed({
  message,
  retry,
  className,
}: {
  message: string;
  retry: () => void;
  className?: string | undefined;
}) {
  return (
    <div role="alert" className={className}>
      <p>{message}</p>
      <Button size="small" onPress={retry}>
        Try again
      </Button>
    </div>
  );
}
