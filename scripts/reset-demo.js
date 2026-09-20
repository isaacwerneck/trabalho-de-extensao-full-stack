import fs from 'node:fs';
import path from 'node:path';
import { createDatabase } from '../src/database.js';
import { getConfig } from '../src/config.js';

const confirmed = process.argv.includes('--confirm');
const databaseArgument = process.argv.find(argument => argument.startsWith('--database='))?.slice('--database='.length);

if (!confirmed) {
  console.error('Operação cancelada. Execute novamente com --confirm para recriar os dados demonstrativos.');
  process.exit(1);
}

const config = getConfig(databaseArgument ? { databasePath: path.resolve(databaseArgument) } : {});
if (config.nodeEnv === 'production') {
  console.error('O reset do banco é bloqueado em produção.');
  process.exit(1);
}
if (path.extname(config.databasePath).toLowerCase() !== '.sqlite') {
  console.error('O destino deve ser um arquivo com extensão .sqlite.');
  process.exit(1);
}

for (const target of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

const db = createDatabase(config);
db.close();
console.log(`Banco demonstrativo recriado em ${config.databasePath}`);
