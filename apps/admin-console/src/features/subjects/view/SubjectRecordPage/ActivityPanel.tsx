import { useSubjectActivity } from '#/features/subjects/usecase/useSubjectActivity.ts';
import { ActivityTab } from '#/shared/view/ActivityTab';
import styles from '#/features/subjects/view/SubjectRecordPage/Tab.module.css';

export function ActivityPanel({ tenant, id }: { tenant: string; id: string }) {
  const list = useSubjectActivity(tenant, id);
  return (
    <div className={styles.tab}>
      <p className={styles.rule}>
        Every change made to this subject, and every change refused. Its sign-ins are filed under
        the session they began, and the end of a single session under that session, so neither is
        listed here.
      </p>
      <ActivityTab list={list} noun="subject" />
    </div>
  );
}
