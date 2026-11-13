import type { FlowWire } from '#/pages/flow/types/flows';
import { AreaGate } from '#/widgets/shell';
import type { FlowsWords } from '#/pages/flow/services/flowsWords';
import { useFlowEditor } from '#/pages/flow/use-cases/useFlowEditor';
import { useFlowPage } from '#/pages/flow/use-cases/useFlowPage';
import { useFlowRecordArea, useFlowRecordPage } from '#/pages/flow/use-cases/useFlowRecordPage';
import { Steps } from '#/pages/flow/ui/Steps';
import { TextField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';
import { ReadGate } from '#/shared/ui/ReadGate';
import { StatusTag } from '#/shared/ui/StatusTag';

function Editor({
  tenant,
  flow,
  etag,
  gone,
  available,
  words,
}: {
  tenant: string;
  flow: FlowWire;
  etag: string;
  gone: boolean;
  available: readonly string[];
  words: FlowsWords['record'];
}) {
  const editor = useFlowEditor({ tenant, flow, etag, gone, available });
  const steps = useFlowPage().words.steps;
  const s = editor.save;
  return (
    <Steps
      flow={editor}
      words={{ ...steps, noticeTitle: words.noticeTitle }}
      lead={
        <TextField
          label={words.nameLabel}
          description={words.nameHelp}
          value={s.values.name}
          error={s.fieldErrors.name}
          onChange={(value) => {
            s.edit('name', value);
          }}
          mono
        />
      }
    />
  );
}

function Record({ tenant, id }: { tenant: string; id: string }) {
  const page = useFlowRecordPage(tenant, id);
  const { words } = page;
  return (
    <>
      <PageHeader
        breadcrumb={page.trail}
        title={page.title}
        {...(page.record.data?.is_default === true
          ? {
              status: <StatusTag tone="active">{words.defaultTag}</StatusTag>,
              description: words.defaultNote,
            }
          : {})}
      />
      <ReadGate read={page.record} label={words.loading} fields={3} failed={words.failed}>
        {(flow, etag) => (
          <Editor
            tenant={tenant}
            flow={flow}
            etag={etag}
            gone={page.record.gone}
            available={page.available}
            words={words}
          />
        )}
      </ReadGate>
    </>
  );
}

export function FlowRecordPage({ tenant, id }: { tenant: string; id: string }) {
  const { area, title, trail } = useFlowRecordArea(tenant);
  return (
    <AreaGate tenant={tenant} area={area} title={title} breadcrumb={trail}>
      <Record tenant={tenant} id={id} />
    </AreaGate>
  );
}
