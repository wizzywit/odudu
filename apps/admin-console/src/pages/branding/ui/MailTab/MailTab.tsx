import { PreviewShell } from '#/features/branding-editor';
import type { InheritsView, PaletteView } from '#/pages/branding/services/mailTabView';
import { useId } from 'react';
import type { MailTab as Mail } from '#/pages/branding/use-cases/useMailTab';
import { MailClientChoice } from '#/pages/branding/ui/MailClientChoice';
import { InlineFields, SelectField } from '#/shared/ui/Field';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/pages/branding/ui/MailTab/MailTab.module.css';

export function MailPreview({ mail }: { mail: Mail }) {
  const { view: preview } = mail.preview;
  return (
    <PreviewShell
      title={preview.title}
      summary={preview.summary}
      lead={preview.lead}
      controls={
        <>
          <InlineFields>
            <SelectField
              label={preview.scheme.label}
              options={preview.scheme.options}
              value={preview.scheme.value}
              onChange={mail.preview.chooseScheme}
            />
            <SelectField
              label={preview.locale.label}
              options={preview.locale.options}
              value={preview.locale.value}
              onChange={mail.preview.chooseLocale}
            />
          </InlineFields>
          <MailClientChoice mail={mail} />
        </>
      }
      frame={{
        title: preview.frameTitle,
        src: mail.frame.src,
        frameKey: mail.frame.key,
        loading: mail.frame.loading,
        onLoaded: mail.frame.onLoaded,
      }}
    />
  );
}

function Logos({ logos }: { logos: InheritsView['logos'] }) {
  return (
    <Panel title={logos.title}>
      <dl className={styles.facts}>
        {logos.items.map((logo) => (
          <div key={logo.label} className={styles.fact}>
            <dt>{logo.label}</dt>
            <dd>
              {logo.src === null ? (
                logo.empty
              ) : (
                <>
                  {logo.picture === null ? (
                    <span>{logo.alt}</span>
                  ) : (
                    <img className={styles.picture} src={logo.picture} alt={logo.alt ?? ''} />
                  )}{' '}
                  <span className={styles.size}>{logo.size}</span>
                  <code className={styles.address}>{logo.src}</code>
                  {logo.picture === null ? (
                    <span className={styles.size}>{logos.elsewhere}</span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Palette({ palette }: { palette: PaletteView }) {
  const { columns } = palette;
  return (
    <Panel title={palette.legend}>
      <p className={recordTab.rule}>{palette.source}</p>
      <table className={styles.table}>
        <caption className={styles.caption}>{palette.legend}</caption>
        <thead>
          <tr>
            <th scope="col">{columns.colour}</th>
            <th scope="col">{columns.value}</th>
            <th scope="col">{columns.used}</th>
          </tr>
        </thead>
        <tbody>
          {palette.rows.map((row) => (
            <tr key={row.role}>
              <th scope="row">{row.label}</th>
              <td>
                <span
                  className={styles.swatch}
                  style={{ backgroundColor: row.colour }}
                  aria-hidden="true"
                />
                <code>{row.colour}</code>
              </td>
              <td>{row.used}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function MailInherits({ mail }: { mail: Mail }) {
  const { words, read } = mail.inherits;
  const heading = useId();
  if (read.status === 'loading') {
    return <FormSkeleton label={words.loading} fields={3} />;
  }
  if (read.status === 'failed') {
    return <LoadFailed title={words.failed} retry={read.retry} />;
  }
  const inherits = read.data;
  return (
    <div className={styles.inherits}>
      <section aria-labelledby={heading} className={styles.lead}>
        <h2 id={heading} className={styles.heading}>
          {inherits.title}
        </h2>
        <p className={recordTab.rule}>{inherits.lead}</p>
        <p className={recordTab.rule}>{inherits.note}</p>
      </section>
      <Logos logos={inherits.logos} />
      {inherits.palettes.map((palette) => (
        <Palette key={palette.scheme} palette={palette} />
      ))}
    </div>
  );
}
