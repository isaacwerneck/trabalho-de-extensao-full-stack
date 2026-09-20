import { createApp } from './app.js';

const { app, config, db } = createApp();

const server = app.listen(config.port, () => {
  console.log(`Patas na Rua disponível em http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando o servidor...`);
  const forceExit = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 5_000).unref();
  server.close(() => {
    clearTimeout(forceExit);
    db.close();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
