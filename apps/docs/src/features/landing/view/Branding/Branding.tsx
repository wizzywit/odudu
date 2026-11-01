import { DocsLink } from '@site/src/shared/view/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { BRANDING } from '@site/src/features/landing/service/content';
import { useBrandingPictures } from '@site/src/features/landing/usecase/useBrandingPictures';
import { Frame } from '@site/src/features/landing/view/Frame/Frame';
import { Section } from '@site/src/features/landing/view/Section/Section';
import styles from '@site/src/features/landing/view/Branding/Branding.module.css';

const LOOKS = { odudu: styles.odudu, other: styles.other };
const SCHEMES = { light: styles.light, dark: styles.dark };

export function Branding(): ReactElement {
  const pictures = useBrandingPictures();
  const picture = (
    <figure className={styles.figure}>
      <Frame kind="look">
        {pictures.map((item) => (
          <img
            key={item.src}
            className={[styles.picture, LOOKS[item.look], SCHEMES[item.scheme]].join(' ')}
            src={item.src}
            alt={item.alt}
            width={item.width}
            height={item.height}
            loading="lazy"
          />
        ))}
      </Frame>
      <figcaption className={styles.caption}>{BRANDING.caption}</figcaption>
    </figure>
  );
  return (
    <Section
      id="home-branding"
      kicker="Make it yours"
      title={BRANDING.title}
      section="branding"
      tone="sunken"
      aside={picture}
    >
      <p className={styles.body}>
        {BRANDING.claim} <DocsLink to={BRANDING.guide.path}>{BRANDING.guide.label}</DocsLink>
      </p>
      <fieldset className={styles.looks}>
        <legend className={styles.legend}>{BRANDING.legend}</legend>
        <label className={styles.look}>
          <input
            className={styles.pickOdudu}
            type="radio"
            name="branding-look"
            value="odudu"
            defaultChecked
          />{' '}
          Odudu look
        </label>
        <label className={styles.look}>
          <input className={styles.pickOther} type="radio" name="branding-look" value="other" /> A
          tenant&apos;s theme
        </label>
      </fieldset>
    </Section>
  );
}
