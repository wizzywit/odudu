import type { AssistantSettings } from '#/pages/settings/types/assistant';
import {
  useAssistantSection,
  type AssistantAvailability,
} from '#/pages/settings/use-cases/useAssistantSection';
import { SettingsFields } from '#/pages/settings/ui/SettingsFields';
import { ReadOnlyFields } from '#/shared/ui/Field';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';

type Shown = Pick<AssistantAvailability, 'readOnly' | 'words' | 'headingId' | 'plan'>;

function Loaded({
  tenant,
  data,
  etag,
  gone,
  readOnly,
  words,
  headingId,
  plan,
}: {
  tenant: string;
  data: AssistantSettings;
  etag: string;
  gone: boolean;
} & Shown) {
  const save = useAssistantSection({ tenant, data, etag, gone });
  return (
    <ReadOnlyFields when={readOnly}>
      <SaveSection
        title={words.title}
        headingId={headingId}
        description={words.description}
        save={save}
      >
        {readOnly ? <ViewOnlyNote noun={words.noun} needs={words.needs} /> : null}
        <SettingsFields plan={plan} save={save} fixed={{}} />
      </SaveSection>
    </ReadOnlyFields>
  );
}

// The assistant's own section of the settings: not drawn while it is read, nor
// where the deployment has no assistant or the caller has no business here.
export function AssistantSection({
  tenant,
  assistant,
}: {
  tenant: string;
  assistant: AssistantAvailability;
}) {
  const { presence, read, readOnly, words, headingId, plan } = assistant;
  if (presence === 'failed') return <LoadFailed title={words.failed} retry={read.retry} />;
  if (presence !== 'ready' || read.data === undefined || read.etag === null) return null;
  return (
    <Loaded
      tenant={tenant}
      data={read.data}
      etag={read.etag}
      gone={read.gone}
      readOnly={readOnly}
      words={words}
      headingId={headingId}
      plan={plan}
    />
  );
}
