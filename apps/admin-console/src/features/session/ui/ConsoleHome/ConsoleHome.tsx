import { useConsoleHome } from '#/features/session/use-cases/useConsoleHome';
import { SignedInElsewhere } from '#/features/session/ui/SignedInElsewhere';
import { SignIn } from '#/features/session/ui/SignIn';
import { SigningIn } from '#/features/session/ui/SigningIn';

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
      notice={home.notice}
      enters={home.enters}
      replacing={home.replacing}
      onSignIn={home.choose}
      check={home.check}
    />
  );
}
