// A ordem das importações é relevante: as variáveis de ambiente devem ser configuradas antes do carregamento dos módulos.
import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Express } from 'express';
import Stripe from 'stripe';

import { createApp } from '../src/app.js';
import type { OrderRow } from '../src/types.js';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ares-')), 'test.db');
}

async function withServer(fn: (base: string, app: Express) => Promise<void>): Promise<void> {
  const app = createApp({ dbPath: tmpDb(), webhookSecret: process.env.STRIPE_WEBHOOK_SECRET });
  const server = app.listen(0) as Server;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await fn(base, app);
  } finally {
    server.close();
  }
}

interface SignedHeaders {
  'Stripe-Signature': string;
  'Content-Type': string;
}

function signedHeaders(payload: string): SignedHeaders {
  const client = new Stripe('sk_test_placeholder', {});
  const sig = client.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });
  return { 'Stripe-Signature': sig, 'Content-Type': 'application/json' };
}

function eventPayload(id: string, type: string, orderId: string): string {
  return JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object: { id: 'pi_123', object: 'payment_intent', metadata: { order_id: orderId } } },
  });
}

async function createOrder(base: string): Promise<string> {
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'sku-areia' }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { orderId: string }).orderId;
}

interface OrderRow {
  status: string;
  processed_events_count: number;
  paid_at: string | null;
}

test('CONTROLE 2: webhook sem assinatura é rejeitado com status 400 e não altera o banco', async () => {
  await withServer(async (base, app) => {
    const orderId = await createOrder(base);
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: eventPayload('evt_no_sig', 'payment_intent.succeeded', orderId),
    });
    assert.equal(res.status, 400);

    const order = app.locals.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as Pick<OrderRow, 'status'>;
    assert.equal(order.status, 'pending');
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) c FROM processed_events').get().c, 0);
  });
});

test('CONTROLE 2: assinatura válida sobre payload adulterado é rejeitada com status 400', async () => {
  await withServer(async (base, app) => {
    const orderId = await createOrder(base);
    const payload = eventPayload('evt_tamper', 'payment_intent.succeeded', orderId);
    const headers = signedHeaders(payload);

    // Envia corpo diferente do que foi assinado.
    const res = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers,
      body: payload.replace('"pi_123"', '"pi_999"'),
    });
    assert.equal(res.status, 400);

    const order = app.locals.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as Pick<OrderRow, 'status'>;
    assert.equal(order.status, 'pending');
  });
});

test('CONTROLES 2 e 3: evento válido confirma o pagamento e repetição não processa em duplicidade', async () => {
  await withServer(async (base, app) => {
    const orderId = await createOrder(base);

    // Primeiro envio do evento.
    const okPayload = eventPayload('evt_dup_1', 'payment_intent.succeeded', orderId);
    const headers1 = signedHeaders(okPayload);
    const res1 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: headers1, body: okPayload });
    assert.equal(res1.status, 200);
    assert.deepEqual(await res1.json(), { received: true });

    let order = app.locals.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow;
    assert.equal(order.status, 'paid');
    assert.equal(order.processed_events_count, 1);
    const paidAtFirst = order.paid_at;

    // Reenvio do mesmo evento com identificador idêntico.
    const res2 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: headers1, body: okPayload });
    assert.equal(res2.status, 200);
    assert.deepEqual(await res2.json(), { received: true, duplicated: true });

    order = app.locals.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow;
    assert.equal(order.status, 'paid');
    assert.equal(order.processed_events_count, 1, 'o contador de eventos não deve ser incrementado na repetição');
    assert.equal(order.paid_at, paidAtFirst, 'a data de confirmação do pagamento não deve ser alterada');
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) c FROM processed_events').get().c, 1);

    // Defesa em profundidade: um evento com identificador diferente para o mesmo pedido não deve gerar reprocessamento (trava de status).
    const otherPayload = eventPayload('evt_other_9', 'payment_intent.succeeded', orderId);
    const headers2 = signedHeaders(otherPayload);
    const res3 = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: headers2, body: otherPayload });
    assert.equal(res3.status, 200);

    order = app.locals.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow;
    assert.equal(order.status, 'paid');
    assert.equal(order.processed_events_count, 1, 'o pedido deve ser processado apenas uma vez mesmo com novo identificador de evento');
  });
});

test('CONTROLE 1: criação de PaymentIntent não recebe dados de cartão e utiliza o valor definido no servidor', async () => {
  await withServer(async (base) => {
    // O catálogo define o preço; o cliente apenas escolhe o SKU. Parâmetros como amount ou card[number] são ignorados.
    const res = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'sku-cascalho', amount_cents: 1, 'card[number]': '4242424242424242' }),
    });
    assert.equal(res.status, 201);
    const order = (await res.json()) as Record<string, unknown>;
    assert.equal(order.amount_cents, 4990, 'o valor deve ser obtido a partir do catálogo do servidor');
    assert.equal(order['card[number]'], undefined, 'nenhum dado de cartão deve ser armazenado ou retornado');
  });
});

