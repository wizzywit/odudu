import {
  PreviewShell,
  previewSummary,
  type Scheme,
  SCHEME_LABELS,
  SCHEME_PICKER_LABEL,
  schemeColoursTitle,
  schemeOf,
  schemeOptions,
} from '#/features/branding-editor';
import type { MailBrandingView } from '#/pages/branding/types/mailBranding';
import { useId } from 'react';
import { logoViews, LOGO_ELSEWHERE, LOGO_TITLE } from '#/pages/branding/services/mailLogos';
import {
  MAIL_CLIENTS_NOTE,
  mailInheritsLead,
  MAIL_INHERITS_TITLE,
  paletteRows,
  sourceText,
} from '#/pages/branding/services/mailInheritance';
import {
  MAIL_FAILED,
  MAIL_FRAME_TITLE,
  MAIL_LOADING_BRANDING,
  mailPreviewNote,
  MAIL_PREVIEW_TITLE,
} from '#/pages/branding/services/mailPreview';
import { mailClientName } from '#/pages/branding/services/mailChoice';
import {
  MAIL_LOCALE_LABEL,
  MAIL_LOCALE_OPTIONS,
  mailLocaleLabel,
  mailLocaleOf,
  MAIL_SUMMARY_NAME,
} from '#/pages/branding/services/mailLocale';
import type { MailTab as Mail } from '#/pages/branding/use-cases/useMailTab';
import { MailClientChoice } from '#/pages/branding/ui/MailClientChoice';
import { InlineFields, SelectField } from '#/shared/ui/Field';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/pages/branding/ui/MailTab/MailTab.module.css';

export function MailPreview({ mail }: { mail: Mail }) {
  return (
    <PreviewShell
      title={MAIL_PREVIEW_TITLE}
      summary={previewSummary(
        MAIL_SUMMARY_NAME,
        SCHEME_LABELS[mail.choice.scheme],
        mailLocaleLabel(mail.choice.locale),
        mailClientName(mail.client) ?? '',
      )}
      lead={mailPreviewNote(mailClientName(mail.client))}
      controls={
        <>
          <InlineFields>
            <SelectField
              label={SCHEME_PICKER_LABEL}
              options={schemeOptions}
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
          <MailClientChoice mail={mail} />
        </>
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
    <Panel title={schemeColoursTitle(scheme)}>
      <p className={recordTab.rule}>{sourceText(view.source)}</p>
      <table className={styles.table}>
        <caption className={styles.caption}>{schemeColoursTitle(scheme)}</caption>
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
        <p className={recordTab.rule}>{mailInheritsLead(mailClientName(mail.client))}</p>
        <p className={recordTab.rule}>{MAIL_CLIENTS_NOTE}</p>
      </section>
      <Logos branding={branding.data} origin={mail.origin} />
      <Palette scheme="light" view={branding.data.light} />
      <Palette scheme="dark" view={branding.data.dark} />
    </div>
  );
}
