import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

export interface TestDatabase {
  readonly adminUrl: string;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  return {
    adminUrl: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

export async function createAppRole(adminUrl: string): Promise<string> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });

  try {
    await admin`CREATE USER odudu_svc LOGIN PASSWORD 'odudu_svc'`;
    await admin`GRANT odudu_app TO odudu_svc`;
  } finally {
    await admin.end({ timeout: 5 });
  }

  const url = new URL(adminUrl);
  url.username = 'odudu_svc';
  url.password = 'odudu_svc';
  return url.toString();
}
