import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

const dataDir = process.env.HOME_OS_DATA_DIR
  ? path.resolve(process.env.HOME_OS_DATA_DIR)
  : path.resolve(process.cwd(), '..', '..', '.data');

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: path.join(dataDir, 'db', 'home-os.sqlite'),
  },
});
