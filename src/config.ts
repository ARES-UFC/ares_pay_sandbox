import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Falha rápida e explícita: impede a inicialização do serviço sem o
    // segredo do webhook, garantindo que a validação de assinatura esteja sempre ativa.
    throw new Error(
      `Variável de ambiente obrigatória não encontrada: ${name}. Copie o arquivo .env.example para .env e configure as credenciais de teste do Stripe.`,
    );
  }
  return value;
}

const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || './data/ares_pay.db',

  get stripeSecretKey(): string {
    return required('STRIPE_SECRET_KEY');
  },
  get stripePublishableKey(): string {
    return required('STRIPE_PUBLISHABLE_KEY');
  },
  get stripeWebhookSecret(): string {
    return required('STRIPE_WEBHOOK_SECRET');
  },
};

export default config;
