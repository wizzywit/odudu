import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { landingJsonLd } from '@site/seo';
import { motionMark } from '@site/src/features/landing/services/reveal';
import { siteAddress } from '@site/src/features/landing/services/site';
import { useReveal } from '@site/src/features/landing/use-cases/useReveal';

export interface LandingPage {
  // True once the reveal has taken hold; the page marks itself for the stylesheet.
  motion: boolean;
  mark: 'ok' | undefined;
  jsonLd: string;
}

export function useLandingPage(): LandingPage {
  const { siteConfig } = useDocusaurusContext();
  const motion = useReveal();
  return {
    motion,
    mark: motionMark(motion),
    jsonLd: landingJsonLd(siteAddress(siteConfig)),
  };
}
