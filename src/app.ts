import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';

import config from './config.js';
import { openDb } from './db.js';
import checkoutRoutes from './routes/checkout.js';
import webhookRoutes from './routes/webhook.js';
import './types.js';

interface CreateAppOptions {
  dbPath?: string;
  webhookSecret?: string | null;
}

export function createApp({ dbPath = config.dbPath, webhookSecret = null }: CreateAppOptions = {}): express.Express {
  const db = openDb(dbPath);
  const app = express();

  // Estado compartilhado com as rotas (conexão com o banco e chaves de configuração).
  app.locals.db = db;
  app.locals.webhookSecret = webhookSecret || config.stripeWebhookSecret;
  app.locals.publishableKey = config.stripePublishableKey;

  // CONTROLE 2: o endpoint de webhook necessita do corpo bruto da requisição (raw body).
  // O HMAC da assinatura é validado sobre a sequência exata de bytes recebidos.
  // Caso ocorra o parse ou reordenação prévia dos dados, a assinatura calculada
  // não coincidirá com a enviada pelo Stripe. Por essa razão, esta rota é configurada
  // antes do middleware express.json() global.
  app.use('/webhooks', webhookRoutes);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', checkoutRoutes);

  // Erros de validação de assinatura do Stripe retornam status 400 em vez de 500.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'StripeSignatureVerificationError') {
      return res.status(400).json({ error: 'invalid_signature' });
    }
    if (type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  });

  // Gerador de identificadores únicos para os registros.
  app.locals.idFactory = () => crypto.randomUUID();

  return app;
}
