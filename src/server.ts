import { createApp } from './app.js';
import config from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`ares_pay_sandbox em execução no modo de testes do Stripe em http://localhost:${config.port}`);
});
