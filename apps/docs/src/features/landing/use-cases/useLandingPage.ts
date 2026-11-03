import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { landingJsonLd } from '@site/seo';
import {
  CAPABILITIES,
  EXAMPLES,
  EXAMPLES_URL_PATH,
  LICENSING_URL_PATH,
  MARKDOWN_LINE,
  READERS,
  WORDPRESS,
  type Card,
  type MarkdownLine,
  type WordpressLine,
} from '@site/src/features/landing/services/capabilityCards';
import { BRANDING, type BrandingItem } from '@site/src/features/landing/services/brandingClaim';
import { shotsOfSize } from '@site/src/features/landing/services/pageShot';
import {
  AGENT_ITEMS,
  PLANNED_LABEL,
  ROADMAP_NEXT,
  type Planned,
} from '@site/src/features/landing/services/plannedClaims';
import { motionMark } from '@site/src/features/landing/services/reveal';
import { type PageShotCard } from '@site/src/features/landing/services/serverPageCards';
import { siteAddress } from '@site/src/features/landing/services/site';
import { STEPS, type StartStep } from '@site/src/features/landing/services/startSteps';
import { useReveal } from '@site/src/features/landing/use-cases/useReveal';

export interface LandingPage {
  // True once the reveal has taken hold; the page marks itself for the stylesheet.
  motion: boolean;
  mark: 'ok' | undefined;
  jsonLd: string;
  capabilities: Card[];
  steps: StartStep[];
  readers: Card[];
  examples: { cards: Card[]; wordpress: WordpressLine; sourcePath: string };
  agents: { items: Planned[]; plannedLabel: string; roadmapPath: string };
  branding: BrandingItem;
  markdown: MarkdownLine;
  where: { licensingPath: string };
  pageShots: { large: PageShotCard[]; small: PageShotCard[] };
}

export function useLandingPage(): LandingPage {
  const { siteConfig } = useDocusaurusContext();
  const motion = useReveal();
  return {
    motion,
    mark: motionMark(motion),
    jsonLd: landingJsonLd(siteAddress(siteConfig)),
    capabilities: CAPABILITIES,
    steps: STEPS,
    readers: READERS,
    examples: { cards: EXAMPLES, wordpress: WORDPRESS, sourcePath: EXAMPLES_URL_PATH },
    agents: { items: AGENT_ITEMS, plannedLabel: PLANNED_LABEL, roadmapPath: ROADMAP_NEXT },
    branding: BRANDING,
    markdown: MARKDOWN_LINE,
    where: { licensingPath: LICENSING_URL_PATH },
    pageShots: { large: shotsOfSize('large'), small: shotsOfSize('small') },
  };
}
