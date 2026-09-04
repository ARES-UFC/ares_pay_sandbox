// Deve ser o primeiro import nos testes: define as variáveis de ambiente
// antes do carregamento de src/config.ts e src/stripe.ts.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test_secret';
