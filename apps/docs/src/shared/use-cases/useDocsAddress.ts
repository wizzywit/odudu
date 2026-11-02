import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { docsAddress, docsRouteOf } from '@site/src/shared/services/docsAddress';

// Where a documentation route is in this build, ready for a link.
export function useDocsAddress(route: string): string {
  const { siteConfig } = useDocusaurusContext();
  return docsAddress(docsRouteOf(siteConfig.customFields), route);
}
