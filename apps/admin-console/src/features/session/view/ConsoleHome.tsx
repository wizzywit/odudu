import { useConsoleHome } from '#/features/session/usecase/useConsoleHome.ts';
import { SignedInElsewhere } from '#/features/session/view/SignedInElsewhere.tsx';
import { SignIn } from '#/features/session/view/SignIn.tsx';
import { SigningIn } from '#/features/session/view/SigningIn.tsx';

export function ConsoleHome() {
  const home = useConsoleHome();
  if (home.kind === 'leaving') return <SigningIn tenant={home.tenant} ended={false} />;
  if (home.kind === 'elsewhere') {
    return (
      <SignedInElsewhere principal={home.principal} tenant={home.tenant} onSignIn={home.signIn} />
    );
  }
  return (
    <SignIn
      remembered={home.remembered}
      enters={home.enters}
      onSignIn={home.choose}
      check={home.check}
    />
  );
}
