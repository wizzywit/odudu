import { useId } from 'react';
import type { Client } from '#/entities/client';
import {
  type Artefact,
  EVALUATE_CAPABILITY,
  EVALUATE_HEADING,
  EVALUATE_LABEL,
  EVALUATE_RULE,
  NO_ID_TOKEN,
  SCOPE_LABEL,
  SCOPE_RULE,
  SUBJECT_PICKER_LABEL,
} from '#/pages/clients/services/evaluate';
import {
  useClientEvaluate,
  useEvaluateAllowed,
  type ClientEvaluate,
} from '#/pages/clients/use-cases/useClientEvaluate';
import { Button } from '#/shared/ui/Button';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { CopyValue } from '#/shared/ui/CopyValue';
import { TextField } from '#/shared/ui/Field';
import { Problem } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { Picker } from '#/shared/ui/Picker';
import { recordTab } from '#/shared/ui/RecordTab';
import { type Subject } from '#/entities/subject';
import styles from '#/pages/clients/ui/Evaluate/Evaluate.module.css';

function Box({ artefact }: { artefact: Artefact }) {
  const heading = useId();
  return (
    <div className={styles.artefact}>
      <h3 id={heading} className={styles.heading}>
        {artefact.heading}
      </h3>
      {artefact.text === null ? (
        <p className={recordTab.rule}>{NO_ID_TOKEN}</p>
      ) : (
        <CopyValue label={artefact.label} value={artefact.text} block labelledBy={heading} />
      )}
    </div>
  );
}

function Form({ page }: { page: ClientEvaluate }) {
  return (
    <>
      <Picker<Subject>
        label={SUBJECT_PICKER_LABEL}
        noun={{ one: 'subject', other: 'subjects' }}
        picker={page.picker}
        idOf={(subject) => subject.id}
        nameOf={page.subjectLabel}
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
      <div className={recordTab.actions}>
        <Button
          variant="primary"
          isDisabled={page.chosen === null || page.busy}
          onPress={page.evaluate}
        >
          {EVALUATE_LABEL}
        </Button>
      </div>
      <Problem>{page.problem}</Problem>
      {page.worked === null ? null : (
        <div className={styles.claims}>
          <p role="status" className={recordTab.text}>{`Claims for ${page.worked}.`}</p>
          {page.artefacts.map((artefact) => (
            <Box key={artefact.label} artefact={artefact} />
          ))}
        </div>
      )}
    </>
  );
}

function Asked({ tenant, client }: { tenant: string; client: Client }) {
  return <Form page={useClientEvaluate(tenant, client)} />;
}

export function Evaluate({ tenant, client }: { tenant: string; client: Client }) {
  const allowed = useEvaluateAllowed(tenant);
  return (
    <Panel title={EVALUATE_HEADING}>
      <p className={recordTab.rule}>{EVALUATE_RULE}</p>
      {allowed ? (
        <Asked tenant={tenant} client={client} />
      ) : (
        <CapabilityNote capability={EVALUATE_CAPABILITY}>Evaluating a subject</CapabilityNote>
      )}
    </Panel>
  );
}
