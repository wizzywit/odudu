import type { Preview } from '#/features/branding-editor/use-cases/usePreview';
import { PreviewShell } from '#/features/branding-editor/ui/PreviewShell';
import { InlineFields, SelectField } from '#/shared/ui/Field';
import { Note } from '#/shared/ui/Note';
import styles from '#/features/branding-editor/ui/PreviewPane/PreviewPane.module.css';

// The real page for the saved draft, in a frame that may run nothing and
// shares no origin with the console.
export function PreviewPane({ preview, pickKind }: { preview: Preview; pickKind: boolean }) {
  const { words } = preview;
  return (
    <PreviewShell
      title={words.title}
      summary={preview.summary}
      lead={words.lead}
      controls={
        <InlineFields>
          {pickKind ? (
            <SelectField
              label={words.kindLabel}
              options={words.kindOptions}
              value={preview.choice.kind}
              onChange={preview.chooseKind}
            />
          ) : null}
          <SelectField
            label={words.schemeLabel}
            options={words.schemeOptions}
            value={preview.choice.scheme}
            onChange={preview.chooseScheme}
          />
        </InlineFields>
      }
      notes={preview.note === null ? null : <Note>{preview.note}</Note>}
      live={
        // Always present so a notice arriving after the read, or changing with
        // the page, is announced politely; it changes on a save, a page or a
        // scheme, never per keystroke.
        <div role="status" aria-label={words.fallbackTitle} className={styles.fallback}>
          {preview.fallback.map((line) => (
            <Note key={line}>{line}</Note>
          ))}
        </div>
      }
      frame={{
        title: words.frameTitle,
        src: preview.src,
        frameKey: preview.frameKey,
        loading: preview.loading,
        retry: preview.retry,
        onLoaded: preview.onLoaded,
      }}
    />
  );
}
