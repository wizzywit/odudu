import { beyondText } from '#/features/subjects/service';
import { Button } from '#/shared/view/Button';
import { Note } from '#/shared/view/Note';

// The one line a record carries when its subject holds more than the caller,
// in place of every write the server would refuse.
export function BeyondNote({ name, beyond }: { name: string; beyond: readonly string[] }) {
  return <Note>{beyondText(name, beyond, 'view')}</Note>;
}

export function ReachFailed({ name, retry }: { name: string; retry: () => void }) {
  return (
    <Note>
      {`What ${name} holds could not be read, so nothing here can be changed until it is. `}
      <Button size="small" variant="quiet" onPress={retry}>
        Read it again
      </Button>
    </Note>
  );
}
