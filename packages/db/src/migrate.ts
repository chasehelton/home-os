import { runMigrations } from './index.js';

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  runMigrations();
  console.log('Migrations applied.');
}
