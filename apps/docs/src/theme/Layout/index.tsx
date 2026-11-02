import Layout from '@theme-original/Layout';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { useLandmark } from '@site/src/shared/use-cases/useLandmark';

type Props = ComponentProps<typeof Layout>;

interface WrapProps {
  children?: ReactNode;
}

function Main({ children }: WrapProps): ReactElement {
  return <main>{children}</main>;
}

function Pass({ children }: WrapProps): ReactElement {
  return <>{children}</>;
}

const WRAPPERS = { main: Main, none: Pass };

// The theme's layout, with the page's content in a main landmark when the page asks for one.
export default function LayoutWithLandmark({ children, ...rest }: Props): ReactElement {
  const Wrapper = WRAPPERS[useLandmark()];
  return (
    <Layout {...rest}>
      <Wrapper>{children}</Wrapper>
    </Layout>
  );
}
