import { useConsoleHome } from '#/pages/console-home/use-cases/useConsoleHome';
import { SignedInElsewhere, SigningIn } from '#/entities/session';
import { SignIn } from '#/widgets/session-gate';

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
