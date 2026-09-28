import { useConsoleHome } from '#/features/session/usecase/useConsoleHome.ts';
import { SignIn } from '#/features/session/view/SignIn.tsx';
import { SigningIn } from '#/features/session/view/SigningIn.tsx';

export function ConsoleHome() {
  const home = useConsoleHome();
  if (home.kind === 'leaving') return <SigningIn tenant={home.tenant} ended={false} />;
  return <SignIn remembered={home.remembered} onSignIn={home.choose} check={home.check} />;
}
