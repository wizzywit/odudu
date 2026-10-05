import { Button } from '#/shared/view/Button';
import { Note } from '#/shared/view/Note';

const LIST = new Intl.ListFormat('en-GB', { type: 'conjunction' });

// The one line a record carries when its subject holds more than the caller,
// in place of every write the server would refuse.
export function BeyondNote({ name, beyond }: { name: string; beyond: readonly string[] }) {
  return (
    <Note>
      {`${name} holds ${LIST.format(beyond)}, which you do not, so you can view ${name} but change nothing here.`}
    </Note>
  );
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
