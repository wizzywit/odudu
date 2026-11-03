import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { useBrandingPictures } from '@site/src/features/landing/use-cases/useBrandingPictures';
import { Frame } from '@site/src/features/landing/ui/Frame/Frame';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Branding/Branding.module.css';

const LOOKS = { odudu: styles.odudu, other: styles.other };
const SCHEMES = { light: styles.light, dark: styles.dark };

interface Props {
  branding: LandingPage['branding'];
}

export function Branding({ branding }: Props): ReactElement {
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
      <figcaption className={styles.caption}>{branding.caption}</figcaption>
    </figure>
  );
  return (
    <Section
      id="home-branding"
      kicker="Make it yours"
      title={branding.title}
      section="branding"
      tone="sunken"
      aside={picture}
    >
      <p className={styles.body}>
        {branding.claim} <DocsLink to={branding.guide.path}>{branding.guide.label}</DocsLink>
      </p>
      <fieldset className={styles.looks}>
        <legend className={styles.legend}>{branding.legend}</legend>
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
