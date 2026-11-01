import {
  FALLBACK_TITLE,
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  PREVIEW_DIFFERS,
  PREVIEW_FRAME_TITLE,
  PREVIEW_KIND_LABEL,
  PREVIEW_NOTE,
  PREVIEW_SCHEME_LABEL,
  PREVIEW_TITLE,
  previewSummary,
  SCHEME_LABELS,
  SCHEME_OPTIONS,
  schemeOf,
  pageKindOf,
} from '#/features/branding/service';
import type { Preview } from '#/features/branding/usecase/usePreview';
import { PreviewShell } from '#/features/branding/view/PreviewShell';
import { InlineFields, SelectField } from '#/shared/view/Field';
import { Note } from '#/shared/view/Note';
import styles from '#/features/branding/view/PreviewPane/PreviewPane.module.css';

// The real page for the saved draft, in a frame that may run nothing and
// shares no origin with the console.
export function PreviewPane({ preview, pickKind }: { preview: Preview; pickKind: boolean }) {
  return (
    <PreviewShell
      title={PREVIEW_TITLE}
      summary={previewSummary(
        PAGE_KIND_LABELS[preview.choice.kind],
        SCHEME_LABELS[preview.choice.scheme],
        preview.fallback.length === 0 ? '' : PREVIEW_DIFFERS,
      )}
      lead={PREVIEW_NOTE}
      controls={
        <InlineFields>
          {pickKind ? (
            <SelectField
              label={PREVIEW_KIND_LABEL}
              options={PAGE_KIND_OPTIONS}
              value={preview.choice.kind}
              onChange={(id) => {
                const kind = pageKindOf(id);
                if (kind !== undefined) preview.setKind(kind);
              }}
            />
          ) : null}
          <SelectField
            label={PREVIEW_SCHEME_LABEL}
            options={SCHEME_OPTIONS}
            value={preview.choice.scheme}
            onChange={(id) => {
              const scheme = schemeOf(id);
              if (scheme !== undefined) preview.setScheme(scheme);
            }}
          />
        </InlineFields>
      }
      notes={preview.note === null ? null : <Note>{preview.note}</Note>}
      live={
        // Always present so a notice arriving after the read, or changing with
        // the page, is announced politely; it changes on a save, a page or a
        // scheme, never per keystroke.
        <div role="status" aria-label={FALLBACK_TITLE} className={styles.fallback}>
          {preview.fallback.map((line) => (
            <Note key={line}>{line}</Note>
          ))}
        </div>
      }
      frame={{
        title: PREVIEW_FRAME_TITLE,
        src: preview.src,
        frameKey: preview.frameKey,
        loading: preview.loading,
        retry: preview.retry,
        onLoaded: preview.onLoaded,
      }}
    />
  );
}
