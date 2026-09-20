import path from 'node:path';
import process from 'node:process';

try {
  process.loadEnvFile?.();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export function getConfig(overrides = {}) {
  const config = {
    nodeEnv: overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development',
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    databasePath: path.resolve(overrides.databasePath ?? process.env.DATABASE_PATH ?? './data/patas-na-rua.sqlite'),
    uploadDir: path.resolve(overrides.uploadDir ?? process.env.UPLOAD_DIR ?? './public/uploads'),
    sessionHours: Number(overrides.sessionHours ?? process.env.SESSION_HOURS ?? 12),
    adminName: overrides.adminName ?? process.env.ADMIN_NAME ?? 'Administrador',
    adminEmail: (overrides.adminEmail ?? process.env.ADMIN_EMAIL ?? 'admin@patasnarua.local').toLowerCase(),
    adminPassword: overrides.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'TroqueEstaSenha123!'
  };
  if (config.nodeEnv === 'production' && config.adminPassword === 'TroqueEstaSenha123!') {
    throw new Error('Defina ADMIN_PASSWORD com uma senha segura antes de iniciar em produção.');
  }
  return config;
}
