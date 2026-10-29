import { useId } from 'react';
import type { MailBrandingView } from '@odudu/contracts/admin';
import {
  logoViews,
  MAIL_CLIENTS_NOTE,
  MAIL_FAILED,
  MAIL_FRAME_TITLE,
  MAIL_INHERITS_LEAD,
  MAIL_INHERITS_TITLE,
  MAIL_LOADING_BRANDING,
  MAIL_LOCALE_LABEL,
  MAIL_LOCALE_OPTIONS,
  MAIL_PREVIEW_NOTE,
  MAIL_PREVIEW_TITLE,
  MAIL_SCHEME_LABEL,
  LOGO_ELSEWHERE,
  LOGO_TITLE,
  mailLocaleLabel,
  mailLocaleOf,
  MAIL_SUMMARY_NAME,
  paletteRows,
  previewSummary,
  SCHEME_LABELS,
  SCHEME_OPTIONS,
  schemeOf,
  schemeTitle,
  sourceText,
  type Scheme,
} from '#/features/branding/service';
import type { MailTab as Mail } from '#/features/branding/usecase/useMailTab';
import { PreviewShell } from '#/features/branding/view/PreviewShell';
import { InlineFields, SelectField } from '#/shared/view/Field';
import { LoadFailed } from '#/shared/view/LoadFailed';
import { Panel } from '#/shared/view/Panel';
import { recordTab } from '#/shared/view/RecordTab';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/branding/view/MailTab/MailTab.module.css';

export function MailPreview({ mail }: { mail: Mail }) {
  return (
    <PreviewShell
      title={MAIL_PREVIEW_TITLE}
      summary={previewSummary(
        MAIL_SUMMARY_NAME,
        SCHEME_LABELS[mail.choice.scheme],
        mailLocaleLabel(mail.choice.locale),
      )}
      lead={MAIL_PREVIEW_NOTE}
      controls={
        <InlineFields>
          <SelectField
            label={MAIL_SCHEME_LABEL}
            options={SCHEME_OPTIONS}
            value={mail.choice.scheme}
            onChange={(id) => {
              const scheme = schemeOf(id);
              if (scheme !== undefined) mail.setScheme(scheme);
            }}
          />
          <SelectField
            label={MAIL_LOCALE_LABEL}
            options={MAIL_LOCALE_OPTIONS}
            value={mail.choice.locale}
            onChange={(id) => {
              const locale = mailLocaleOf(id);
              if (locale !== undefined) mail.setLocale(locale);
            }}
          />
        </InlineFields>
      }
      frame={{
        title: MAIL_FRAME_TITLE,
        src: mail.src,
        frameKey: mail.frameKey,
        loading: mail.loading,
        onLoaded: mail.onLoaded,
      }}
    />
  );
}

function Logos({ branding, origin }: { branding: MailBrandingView; origin: string }) {
  return (
    <Panel title={LOGO_TITLE}>
      <dl className={styles.facts}>
        {logoViews(branding, origin).map((logo) => (
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
                    <span className={styles.size}>{LOGO_ELSEWHERE}</span>
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

function Palette({ scheme, view }: { scheme: Scheme; view: MailBrandingView['light'] }) {
  return (
    <Panel title={schemeTitle(scheme)}>
      <p className={recordTab.rule}>{sourceText(view.source)}</p>
      <table className={styles.table}>
        <caption className={styles.caption}>{schemeTitle(scheme)}</caption>
        <thead>
          <tr>
            <th scope="col">Colour</th>
            <th scope="col">Value</th>
            <th scope="col">Used for</th>
          </tr>
        </thead>
        <tbody>
          {paletteRows(view.colours).map((row) => (
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
  const { branding } = mail;
  const heading = useId();
  if (branding.status === 'loading') {
    return <FormSkeleton label={MAIL_LOADING_BRANDING} fields={3} />;
  }
  if (branding.status === 'failed') {
    return <LoadFailed title={MAIL_FAILED} retry={branding.retry} />;
  }
  return (
    <div className={styles.inherits}>
      <section aria-labelledby={heading} className={styles.lead}>
        <h2 id={heading} className={styles.heading}>
          {MAIL_INHERITS_TITLE}
        </h2>
        <p className={recordTab.rule}>{MAIL_INHERITS_LEAD}</p>
        <p className={recordTab.rule}>{MAIL_CLIENTS_NOTE}</p>
      </section>
      <Logos branding={branding.data} origin={mail.origin} />
      <Palette scheme="light" view={branding.data.light} />
      <Palette scheme="dark" view={branding.data.dark} />
    </div>
  );
}
