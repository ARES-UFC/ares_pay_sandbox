/*
 * Simulador de webhooks para testes locais sem necessidade de credenciais ativas no Stripe.
 *
 * O script assina o payload seguindo o padrão oficial do Stripe
 * (cabeçalho Stripe-Signature: t=<timestamp>,v1=<HMAC-SHA256>), utilizando
 * a função utilitária da biblioteca oficial para exercitar os controles 2 e 3 localmente:
 *
 *   STRIPE_WEBHOOK_SECRET=whsec_local_dev_secret npm run dev
 *   npx tsx simulator/send-test-webhook.ts order:<id>
 *   npx tsx simulator/send-test-webhook.ts order:<id> --event payment_intent.payment_failed
 *   npx tsx simulator/send-test-webhook.ts order:<id> --tamper
 *
 * Observação: recomendamos executar via `npx tsx ...` para assegurar o repasse correto dos parâmetros.
 */

import Stripe from 'stripe';
import config from '../src/config.js';

const webhookSecret = config.stripeWebhookSecret;

const args = process.argv.slice(2);
const eventType = args.includes('--event') ? args[args.indexOf('--event') + 1] : 'payment_intent.succeeded';
const tamper = args.includes('--tamper');

const orderId = args.find((a) => a.startsWith('order:'))?.slice(6) || process.env.SIM_ORDER_ID;

if (!orderId) {
  console.error(
    'Uso: npm run simulate:webhook -- order:<id-do-pedido> [--event <tipo>] [--tamper]',
  );
  console.error(
    'Para criar um pedido previamente: curl -X POST localhost:3000/api/orders -H "Content-Type: application/json" -d "{\\"sku\\":\\"sku-areia\\"}"',
  );
  process.exit(1);
}

// Identificador determinístico por pedido: executar o comando novamente
// com o mesmo identificador gera exatamente o mesmo evento, simulando o cenário
// de reentrega coberto pelo controle de idempotência.
const payload = JSON.stringify({
  id: `evt_sim_${orderId}`,
  object: 'event',
  type: eventType,
  data: {
    object: {
      id: `pi_sim_${Math.random().toString(36).slice(2, 10)}`,
      object: 'payment_intent',
      amount: 1990,
      currency: 'brl',
      metadata: { order_id: orderId },
    },
  },
});

(async (): Promise<void> => {
  // O método generateTestHeaderString realiza apenas computação local; a chave de API não realiza chamadas de rede.
  const client = new Stripe('sk_test_placeholder', {});
  const sentBody = tamper ? `${payload}{"injected":true` : payload;
  const res = await fetch('http://localhost:3000/webhooks/stripe', {
    method: 'POST',
    headers: {
      // Assina o payload original e envia o corpo adulterado para validar se o servidor rejeita com status 400.
      'Stripe-Signature': client.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }),
      'Content-Type': 'application/json',
    },
    body: sentBody,
  });

  const body = (await res.json()) as unknown;
  console.log(`HTTP ${res.status}`, JSON.stringify(body));

  if (res.status !== 200 && !tamper) process.exit(1);
})();
