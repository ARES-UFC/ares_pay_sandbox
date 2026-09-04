import { Router, Request, Response, raw } from 'express';
import Stripe from 'stripe';

// Cliente local para validação de assinatura: o método constructEvent
// realiza apenas cálculos de HMAC sobre os bytes da requisição, sem efetuar chamadas de rede.
const stripeVerifier = new Stripe('sk_test_placeholder');

const router = Router();

router.post(
  '/stripe',
  raw({ type: 'application/json' }),
  (req: Request, res: Response): void => {
    const db = req.app.locals.db;
    const secret = req.app.locals.webhookSecret;

    // CONTROLE 2: Verificação de assinatura
    // Antes de processar qualquer informação do evento ou persistir dados no banco,
    // validamos o cabeçalho Stripe-Signature contra o corpo bruto da requisição utilizando
    // o segredo configurado. A verificação inclui tolerância temporal de cerca de 5 minutos
    // para mitigar ataques de repetição.
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'missing_signature' });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripeVerifier.webhooks.constructEvent(req.body as Buffer, signature, secret);
    } catch (err) {
      // Rejeita requisições sem assinatura, com assinatura inválida ou expirada, sem efeitos colaterais.
      console.warn(`[webhook] Assinatura inválida: ${(err as Error).message}`);
      res.status(400).json({ error: 'invalid_signature' });
      return;
    }

    // CONTROLE 3: Barreira de idempotência
    // O Stripe adota o modelo de entrega at-least-once, no qual reenvios podem acontecer
    // em virtude de oscilações de rede ou timeouts. O registro do event_id na tabela
    // com restrição de chave primária impede que o mesmo evento seja processado mais de uma vez.
    try {
      db.prepare('INSERT INTO processed_events (event_id, event_type) VALUES (?, ?)').run(
        event.id,
        event.type,
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        console.info(`[webhook] Evento ${event.id} já processado anteriormente. Ignorando entrega duplicada.`);
        res.json({ received: true, duplicated: true });
        return;
      }
      throw err;
    }

    // Aplicação das regras de negócio do evento
    // A transação assegura a consistência entre o status do pedido e a contagem de eventos.
    // A atualização do pedido possui uma trava condicional por status (apenas pedidos pendentes
    // podem ser marcados como pagos), oferecendo uma camada extra de proteção caso um evento
    // com identificador diferente seja recebido para um pedido já finalizado.
    const apply = db.transaction((evt: Stripe.Event): void => {
      switch (evt.type) {
        case 'payment_intent.succeeded': {
          const intent = evt.data.object;
          const orderId = intent.metadata?.order_id;

          const result = db
            .prepare(
              `UPDATE orders
                  SET status = 'paid',
                      paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                      processed_events_count = processed_events_count + 1,
                      payment_intent_id = COALESCE(payment_intent_id, ?)
                WHERE id = ? AND status = 'pending'`,
            )
            .run(intent.id, orderId);

          if (result.changes === 0) {
            console.warn(
              `[webhook] O pedido ${orderId} não estava com status pendente ou não foi encontrado. O evento ${evt.id} foi registrado sem alterações adicionais.`,
            );
          }
          break;
        }

        case 'payment_intent.payment_failed': {
          const intent = evt.data.object;
          const orderId = intent.metadata?.order_id;
          db.prepare(
            `UPDATE orders
                SET status = 'failed',
                    processed_events_count = processed_events_count + 1
              WHERE id = ? AND status = 'pending'`,
          ).run(orderId);
          break;
        }

        default:
          // Eventos de tipos não monitorados são aceitos com status 200 e ignorados.
          // Registrar o identificador evita reprocessamentos futuros caso ocorra novo envio.
          break;
      }
    });

    apply(event);

    res.json({ received: true });
  },
);

export default router;
