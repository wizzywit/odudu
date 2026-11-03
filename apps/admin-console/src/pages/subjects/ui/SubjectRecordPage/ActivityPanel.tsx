import { RecordActivity } from '#/features/record-activity';

export function ActivityPanel({ tenant, id }: { tenant: string; id: string }) {
  return (
    <RecordActivity
      resource="subject"
      tenant={tenant}
      id={id}
      readable
      lead="Every change made to this subject, and every change refused. Its sign-ins are filed under the session they began, and the end of a single session under that session, so neither is listed here."
    />
  );
}
