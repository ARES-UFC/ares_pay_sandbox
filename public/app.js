'use strict';

/*
 * CONTROLE 1: TOKENIZAÇÃO (lado do navegador)
 *
 * Fluxo de execução:
 *  1. POST /api/orders -> cria o pedido pendente no servidor
 *  2. POST /api/orders/:id/payment-intent -> o servidor cria o PaymentIntent
 *     e retorna apenas o client_secret (identificador opaco)
 *  3. Stripe.js inicializa o Payment Element em um iframe seguro do Stripe
 *     e confirma o pagamento: os dados do cartão saem direto do navegador
 *     para a API do Stripe, sem passar pelo backend.
 *  4. O status definitivo do pedido é atualizado apenas após a chegada do webhook assinado.
 */

const statusEl = document.getElementById('status');
const payBtn = document.getElementById('pay-btn');
const confirmBtn = document.getElementById('confirm-btn');
const paymentElementContainer = document.getElementById('payment-element');

let stripe = null;
let elements = null;
let lastOrderId = null;

function setStatus(msg, cls = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${cls}`;
}

async function startPayment() {
  const sku = document.getElementById('sku').value;
  payBtn.disabled = true;
  setStatus('Criando pedido...');

  try {
    const orderRes = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
    });
    if (!orderRes.ok) throw new Error('Falha ao criar o pedido');
    const order = await orderRes.json();
    lastOrderId = order.orderId;

    setStatus('Preparando o formulário seguro de pagamento...');
    const piRes = await fetch(`/api/orders/${order.orderId}/payment-intent`, {
      method: 'POST',
    });
    if (!piRes.ok) throw new Error('Falha ao iniciar a intenção de pagamento');
    const pi = await piRes.json();

    stripe = Stripe(pi.publishableKey);
    elements = stripe.elements({ clientSecret: pi.clientSecret });

    const paymentElement = elements.create('payment');
    paymentElement.mount(paymentElementContainer);
    confirmBtn.hidden = false;
    setStatus('Formulário pronto para pagamento. Preencha os dados e confirme a compra.');
  } catch (err) {
    setStatus(err.message, 'err');
    payBtn.disabled = false;
  }
}

payBtn.addEventListener('click', (e) => {
  e.preventDefault();
  startPayment();
});

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!stripe || !elements) return;

  confirmBtn.disabled = true;
  setStatus('Processando pagamento com o gateway...');

  const { error } = await stripe.confirmPayment({
    elements,
    redirect: 'if_required',
  });

  if (error) {
    setStatus(error.message, 'err');
    confirmBtn.disabled = false;
    return;
  }

  // O resultado definitivo da transação não é esta resposta imediata, mas sim
  // o webhook assinado que será recebido pelo servidor para atualizar o pedido para 'paid'.
  // Aqui informamos o usuário e consultamos o status periodicamente.
  setStatus('Pagamento enviado. Aguardando confirmação via webhook...');
  pollOrderStatus(0);
});

function pollOrderStatus(attempt) {
  const maxAttempts = 15;
  if (attempt > maxAttempts) {
    setStatus('Tempo limite esgotado ao aguardar o webhook. Verifique os logs do servidor.', 'err');
    return;
  }
  setTimeout(async () => {
    if (!lastOrderId) return;
    const res = await fetch(`/api/orders/${lastOrderId}`);
    if (res.ok) {
      const order = await res.json();
      if (order.status === 'paid') return setStatus(`Pedido confirmado com sucesso (${order.id})`, 'ok');
      if (order.status === 'failed') return setStatus('Não foi possível concluir o pagamento do pedido.', 'err');
    }
    pollOrderStatus(attempt + 1);
  }, 1000);
}
