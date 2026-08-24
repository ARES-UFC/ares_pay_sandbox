import { Router, Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import stripe from '../stripe.js';

const router = Router();

/**
 * Cria um pedido pendente. O valor é definido diretamente no servidor
 * a partir do catálogo e não pode ser informado pelo cliente, evitando
 * qualquer tentativa de adulteração de preços na compra.
 */
interface CatalogItem {
  description: string;
  amount_cents: number;
}

const CATALOG: Record<string, CatalogItem> = {
  'sku-areia': { description: 'Pacote Areia (sandbox)', amount_cents: 1990 },
  'sku-cascalho': { description: 'Pacote Cascalho (sandbox)', amount_cents: 4990 },
};

router.post('/orders', (req: Request, res: Response): void => {
  const sku: unknown = req.body?.sku;
  const item = typeof sku === 'string' ? CATALOG[sku] : undefined;
  if (!item) {
    res.status(400).json({ error: 'unknown_sku', available: Object.keys(CATALOG) });
    return;
  }

  const db = req.app.locals.db;
  const id = req.app.locals.idFactory();
  db.prepare('INSERT INTO orders (id, description, amount_cents) VALUES (?, ?, ?)').run(
    id,
    item.description,
    item.amount_cents,
  );

  res.status(201).json({ orderId: id, ...item });
});

/**
 * Cria o PaymentIntent para o pedido.
 *
 * CONTROLE 1 (Tokenização): este endpoint nunca recebe dados de cartão.
 * Não existem parâmetros como número de cartão, CVC ou validade. O navegador
 * coleta as informações com segurança via Stripe.js no iframe e se comunica
 * diretamente com a API do Stripe. O servidor recebe apenas identificadores
 * opacos (client_secret e id do PaymentIntent), orquestrando o fluxo sem ter
 * acesso ao PAN.
 *
 * Idempotência na criação: utilizamos o orderId como chave de idempotência
 * (Idempotency-Key). Caso a chamada seja reenviada por instabilidade de rede,
 * o Stripe retorna o mesmo PaymentIntent sem gerar cobranças duplicadas.
 */
router.post('/orders/:id/payment-intent', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const db = req.app.locals.db;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as
    | { id: string; amount_cents: number; currency: string; description: string; payment_intent_id: string | null }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  if (order.payment_intent_id) {
    // Se o pedido já possui um PaymentIntent associado, reaproveitamos o mesmo registro.
    res.status(200).json({
      clientSecret: `existing:${order.payment_intent_id}`,
      reused: true,
      publishableKey: req.app.locals.publishableKey,
    });
    return;
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amount_cents,
        currency: order.currency,
        description: order.description,
        automatic_payment_methods: { enabled: true },
        metadata: { order_id: order.id },
      },
      { idempotencyKey: `order:${order.id}` },
    );

    db.prepare('UPDATE orders SET payment_intent_id = ? WHERE id = ?').run(intent.id, order.id);

    res.json({
      clientSecret: intent.client_secret,
      publishableKey: req.app.locals.publishableKey,
    });
  } catch (err) {
    next(err);
  }
});

/** Consulta o status atualizado do pedido, utilizada pela interface após a notificação do webhook. */
router.get('/orders/:id', (req: Request, res: Response): void => {
  const order = req.app.locals.db
    .prepare('SELECT id, description, amount_cents, currency, status, paid_at FROM orders WHERE id = ?')
    .get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  res.json(order);
});

export default router;
