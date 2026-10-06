import type { Client, Subject } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  EVALUATE_CAPABILITY,
  EVALUATE_HEADING,
  EVALUATE_LABEL,
  EVALUATE_RULE,
  NO_ID_TOKEN,
  SCOPE_LABEL,
  SCOPE_RULE,
  SUBJECT_PICKER_LABEL,
} from '#/features/clients/service';
import {
  useClientEvaluate,
  useEvaluateAllowed,
  type ClientEvaluate,
} from '#/features/clients/usecase/useClientEvaluate.ts';
import { Button } from '#/shared/view/Button';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { CopyValue } from '#/shared/view/CopyValue';
import { TextField } from '#/shared/view/Field';
import { Picker } from '#/shared/view/Picker';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

function Form({ page }: { page: ClientEvaluate }) {
  return (
    <>
      <Picker<Subject>
        label={SUBJECT_PICKER_LABEL}
        noun={{ one: 'subject', other: 'subjects' }}
        picker={page.picker}
        idOf={(subject) => subject.id}
        nameOf={(subject) => subject.username ?? subject.id}
        detailOf={(subject) => subject.email ?? subject.type}
        searchBy="username"
        capability={EVALUATE_CAPABILITY}
        selected={page.chosen === null ? [] : [page.chosen.id]}
        selectionMode="single"
        onChange={page.choose}
      />
      <TextField
        label={SCOPE_LABEL}
        description={SCOPE_RULE}
        mono
        value={page.scope}
        onChange={page.setScope}
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          isDisabled={page.chosen === null || page.busy}
          onPress={page.evaluate}
        >
          {EVALUATE_LABEL}
        </Button>
      </div>
      {page.problem === null ? null : (
        <p role="alert" className={styles.message}>
          {page.problem}
        </p>
      )}
      {page.worked === null ? null : (
        <div className={styles.claims}>
          <p role="status" className={styles.text}>{`Claims for ${page.worked}.`}</p>
          {page.artefacts.map((artefact) =>
            artefact.text === null ? (
              <p key={artefact.label} className={styles.rule}>
                {NO_ID_TOKEN}
              </p>
            ) : (
              <CopyValue key={artefact.label} label={artefact.label} value={artefact.text} block />
            ),
          )}
        </div>
      )}
    </>
  );
}

function Asked({ tenant, client }: { tenant: string; client: Client }) {
  return <Form page={useClientEvaluate(tenant, client)} />;
}

export function Evaluate({ tenant, client }: { tenant: string; client: Client }) {
  const heading = useId();
  const allowed = useEvaluateAllowed(tenant);
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {EVALUATE_HEADING}
      </h2>
      <p className={styles.rule}>{EVALUATE_RULE}</p>
      {allowed ? (
        <Asked tenant={tenant} client={client} />
      ) : (
        <CapabilityNote capability={EVALUATE_CAPABILITY}>Evaluating a subject</CapabilityNote>
      )}
    </section>
  );
}
