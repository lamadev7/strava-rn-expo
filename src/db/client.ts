import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

/** enableChangeListener powers useLiveQuery reactivity (history updates live while recording) */
const expoDb = openDatabaseSync('trace.db', { enableChangeListener: true });
expoDb.execSync('PRAGMA journal_mode = WAL');
expoDb.execSync('PRAGMA foreign_keys = ON');

export const db = drizzle(expoDb, { schema });
