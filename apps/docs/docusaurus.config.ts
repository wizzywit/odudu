import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes } from 'prism-react-renderer';
import path from 'node:path';
import agentCopies from './plugins/agent-copies';
import codeHighlight from './plugins/code-highlight';
import codeTokens from './plugins/code-tokens';
import { contentDir } from './plugins/content-dir';
import { requireDescriptions } from './plugins/descriptions';
import imageStrip from './plugins/image-strip';
import notFound from './plugins/not-found';
import robots from './plugins/robots';
import stableText from './plugins/stable-text';
import {
  FOOTER_ROUTES,
  NAVBAR_ROUTES,
  OWNER_NOTICE,
  REPOSITORY_URL,
  SECTIONS,
  TRADEMARK_URL,
} from './nav';
import { iconTags, siteHeadTags } from './seo';
import { IMAGE_BASE, PAGES_BASE, SITE_ORIGIN, docsRoute } from './site.config';

const CONTENT = contentDir(process.env.DOCS_CONTENT);
requireDescriptions(path.resolve(__dirname, CONTENT));

const DESCRIPTION =
  'Odudu is a self-hosted OpenID Connect and OAuth 2.0 identity provider. Each page below is plain Markdown.';

const image = process.env.DOCS_TARGET === 'image';
const docs = docsRoute(image);

type PrismTheme = typeof themes.github;

function withSurface(theme: PrismTheme): PrismTheme {
  return { ...theme, plain: { ...theme.plain, backgroundColor: 'var(--code-surface)' } };
}

const preset: Preset.Options = {
  docs: {
    path: CONTENT,
    remarkPlugins: [codeTokens],
    routeBasePath: image ? '/' : 'docs',
    sidebarPath: './sidebars.ts',
    // A directory's index is the page its category links to, so it is not
    // also listed among the category's items.
    async sidebarItemsGenerator({ defaultSidebarItemsGenerator, ...args }) {
      const items = await defaultSidebarItemsGenerator(args);
      return items.filter((item) => !(item.type === 'doc' && item.id.endsWith('/index')));
    },
  },
  blog: false,
  pages: { path: image ? 'src/image-pages' : 'src/pages' },
  sitemap: image ? false : { ignorePatterns: ['**/search/**'] },
  theme: { customCss: './src/css/custom.css' },
};

const themeConfig: Preset.ThemeConfig = {
  // The image names no public address, so it has no social image to link.
  ...(image ? {} : { image: 'brand/social.png' }),
  navbar: {
    title: 'Odudu',
    // Beside the title, which names it: decorative, and it links home with it.
    logo: {
      alt: '',
      src: 'brand/mark-ink.svg',
      srcDark: 'brand/mark-paper.svg',
      width: 28,
      height: 28,
    },
    items: [
      ...NAVBAR_ROUTES.flatMap((route) => {
        const section = SECTIONS.find((candidate) => candidate.route === route);
        return section === undefined
          ? []
          : [{ to: `/${docs}${route}`, label: section.label, position: 'left' as const }];
      }),
      { href: REPOSITORY_URL, label: 'GitHub', position: 'right' },
    ],
  },
  footer: {
    style: 'light',
    logo: {
      alt: '',
      src: 'brand/mark-ink.svg',
      srcDark: 'brand/mark-paper.svg',
      width: 24,
      height: 24,
    },
    links: [
      ...FOOTER_ROUTES.flatMap((route) => {
        const section = SECTIONS.find((candidate) => candidate.route === route);
        return section === undefined ? [] : [{ label: section.label, to: `/${docs}${route}` }];
      }),
      {
        html: `<a class="footer__link-item" href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">GitHub<span class="visually-hidden"> (opens in a new tab)</span></a>`,
      },
      {
        html: `<a class="footer__link-item" href="${TRADEMARK_URL}" target="_blank" rel="noopener noreferrer">Trademark<span class="visually-hidden"> (opens in a new tab)</span></a>`,
      },
    ],
    // Read when the site is built: a build after New Year changes the year.
    copyright: `© ${String(new Date().getUTCFullYear())} Odudu · AGPL-3.0<br>${OWNER_NOTICE}`,
  },
  // The block's own background is a variable, so the scroll hint in custom.css
  // can fade into exactly the colour the theme paints.
  prism: {
    theme: withSurface(themes.github),
    darkTheme: withSurface(themes.dracula),
  },
  colorMode: { respectPrefersColorScheme: true },
};

const config: Config = {
  title: 'Odudu',
  // The image names no public address: the theme needs a URL, and it is bundled.
  url: image ? 'http://localhost' : SITE_ORIGIN,
  baseUrl: image ? IMAGE_BASE : PAGES_BASE,
  customFields: { docsRoute: docs },
  trailingSlash: true,
  baseUrlIssueBanner: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  future: { v4: true },
  markdown: { format: 'detect', hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  headTags: [
    ...siteHeadTags(),
    ...iconTags(image ? IMAGE_BASE : PAGES_BASE),
    ...(image
      ? [{ tagName: 'meta' as const, attributes: { name: 'robots', content: 'noindex' } }]
      : []),
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        indexPages: !image,
        // The image's pages say noindex to crawlers; its own search must still read them.
        forceIgnoreNoIndex: image,
        docsRouteBasePath: image ? '/' : 'docs',
        docsDir: CONTENT,
      },
    ],
  ],
  plugins: [
    [
      agentCopies,
      {
        docsDir: CONTENT,
        useRelativeUrls: image,
        docsRoute: docs,
        title: 'Odudu documentation',
        description: DESCRIPTION,
      },
    ],
    codeHighlight,
    stableText,
    ...(image ? [imageStrip, robots] : [notFound, robots]),
  ],
  presets: [['classic', preset]],
  themeConfig,
};

export default config;
