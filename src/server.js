import { createApp } from './app.js';

const { app, config } = createApp();

app.listen(config.port, () => {
  console.log(`Patas na Rua disponível em http://localhost:${config.port}`);
});
