import { getSession } from '../lib/odudu';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  if (session === null) {
    return (
      <main>
        <h1>Odudu and Next.js</h1>
        <p id="state">Signed out.</p>
        <a href="/api/auth/login?returnTo=/dashboard">Sign in</a>
      </main>
    );
  }
  return (
    <main>
      <h1>Odudu and Next.js</h1>
      <p id="state">Signed in as {String(session.claims.sub)}.</p>
      <a href="/dashboard">Dashboard</a>
    </main>
  );
}
