import Link from '@docusaurus/Link';
import type { ComponentProps, ReactElement } from 'react';
import { useDocsAddress } from '@site/src/shared/lib/use-cases/useDocsAddress';

type Props = Omit<ComponentProps<typeof Link>, 'to'> & {
  // A route of the documentation, as `nav.ts` writes it, with an optional fragment.
  to: string;
};

// A link to a documentation page, wherever this build serves the documentation from.
export function DocsLink({ to, ...rest }: Props): ReactElement {
  return <Link to={useDocsAddress(to)} {...rest} />;
}
