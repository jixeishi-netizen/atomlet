import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://atomlet:atomlet_dev_pw@localhost:55432/atomlet';

const globalForDb = globalThis as unknown as {
  __atomletSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__atomletSql ??
  postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__atomletSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
