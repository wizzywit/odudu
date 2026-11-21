import { getSession } from '../../lib/odudu';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await getSession();
  return (
    <main>
      <h1>Dashboard</h1>
      <p id="state">{session === null ? 'No session.' : `Hello, ${String(session.claims.sub)}.`}</p>
    </main>
  );
}
