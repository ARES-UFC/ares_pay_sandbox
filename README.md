# ares_pay_sandbox

Integração de pagamento em ambiente de testes (**sandbox do Stripe**), focada nos três controles essenciais para uma arquitetura segura e confiável:

| # | Controle | Onde encontrar |
|---|----------|----------------|
| 1 | **Tokenização**: o número do cartão vai diretamente do navegador para o gateway, sem passar pelo servidor da aplicação | `public/app.js`, `src/routes/checkout.ts` |
| 2 | **Webhook com assinatura verificada**: nenhuma alteração é feita no banco de dados antes de validar o HMAC do corpo bruto da requisição contra `STRIPE_WEBHOOK_SECRET` | `src/routes/webhook.ts` |
| 3 | **Idempotência**: o mesmo webhook recebido mais de uma vez processa o pedido apenas uma vez | `processed_events` em `src/db.ts` e `src/routes/webhook.ts` |

> ⚠️ **Ambiente exclusivo de testes.** Este projeto aceita apenas chaves de sandbox
> (`sk_test_...`, `pk_test_...`, `whsec_...`) e os cartões de teste disponibilizados na
> [documentação oficial do Stripe](https://docs.stripe.com/testing). Cartões reais são
> rejeitados automaticamente pelo gateway de testes.

## Comparativo: os 3 controles por gateway

Como os mesmos três controles são resolvidos pelos três gateways sugeridos no enunciado:

| Controle | Stripe *(implementado neste repo)* | Mercado Pago | Pagar.me (Stone) |
|----------|-----------------------------------|--------------|------------------|
| **Tokenização** | Payment Element/Stripe.js renderizado em iframe no navegador; o número do cartão vai direto para a API do Stripe e o backend recebe apenas o `client_secret`/`payment_intent` | Card token de **uso único e curta duração** gerado no frontend via MercadoPago.js; o backend recebe somente o token e o usa na criação do pagamento | `card_token` gerado no frontend pelo checkout transparente/Tokenização JS; o pedido usa `card_token` ou `card_id` de um cartão salvo, e o PAN nunca passa pelo servidor do lojista |
| **Webhook assinado** | Header `Stripe-Signature` (`t=...,v1=...`): HMAC-SHA256 do **corpo bruto** com o `whsec_...`; conferência com tolerância temporal (~5 min) contra replay, feita por `constructEvent` | Header `x-signature` com **timestamp + HMAC** enviados junto da notificação; a validação usa o *secret signature* configurado no painel (o SDK oficial faz a conferência HMAC) | Webhooks v5 são assinados, mas a documentação pública não detalha o formato do header; na v3 os postbacks usavam HMAC do corpo com a encryption key. Como camada extra, recomenda-se reconsultar o recurso (`order_id`/`charge_id`) na API antes de alterar o banco |
| **Idempotência** | Header `Idempotency-Key` nas requisições POST (ex.: criação de PaymentIntent) | Header `Idempotency-Key`, **obrigatório** em requisições de pagamento desde 2023 | Header `Idempotency-Key` nas requisições de criação (pedidos/cobranças), gerada pelo próprio integrador |

Em todos os três o padrão é o mesmo: dados sensíveis tokenizados no navegador, notificações assinadas por HMAC com um secret conhecido só pelas duas pontas e uma chave de idempotência gerada pelo integrador nas chamadas mutantes. A diferença fica no formato do header de assinatura e no rigor com que cada gateway exige a chave de idempotência.

> ℹ️ Apenas a coluna **Stripe** está implementada neste repositório. As colunas de Mercado Pago e Pagar.me são um levantamento a partir da documentação oficial de cada gateway, citada abaixo.

Fontes oficiais:

* Stripe: [Payment Element](https://docs.stripe.com/payments/payment-element) · [Verificação de webhooks](https://docs.stripe.com/webhooks#verify-manually) · [Requisições idempotentes](https://docs.stripe.com/api/idempotent_requests)
* Mercado Pago: [Geração de card token](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/cardtoken) · [Webhooks e validação de assinatura](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks) · [Chave de idempotência obrigatória](https://www.mercadopago.com.br/developers/pt/news/2023/01/04/Idempotency-key-usage-will-be-mandatory)
* Pagar.me (Stone): [Webhooks](https://docs.pagar.me/docs/webhooks) · [Cartão de crédito e tokenização](https://docs.pagar.me/reference/cart%C3%A3o-de-cr%C3%A9dito-1) · [Idempotência](https://conteudo.stone.com.br/idempotencia/)

---

## Como executar o projeto

Requisitos: Node.js ≥ 20 e npm. O projeto utiliza **TypeScript em modo estrito** e roda diretamente a partir do código-fonte via `tsx` (sem etapa de compilação separada). Utilize `npm run dev` para desenvolvimento com recarregamento automático ou `npm start` para inicialização padrão. A verificação de tipos pode ser executada com `npm run typecheck`.

```bash
git clone <este-repo>
cd ares_pay_sandbox
npm install
cp .env.example .env   # no Windows PowerShell: Copy-Item .env.example .env
npm start
```

### Modo A: fluxo completo com conta de testes do Stripe

1. Crie uma conta no [dashboard.stripe.com](https://dashboard.stripe.com) e acesse o modo de testes (**Test mode**).
2. Copie suas chaves de teste em **Developers > API keys** para o arquivo `.env`.
3. Para encaminhar os webhooks para sua máquina, execute a CLI do Stripe em um terminal separado:

   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/webhooks/stripe
   # Copie o código whsec_... exibido no terminal para a variável STRIPE_WEBHOOK_SECRET no .env
   ```

4. Inicie o servidor com `npm start` e acesse `http://localhost:3000`.
5. Realize um pagamento utilizando um cartão de teste oficial (por exemplo, `4242 4242 4242 4242`, qualquer validade futura e qualquer CVC). Mais detalhes na [documentação do Stripe](https://docs.stripe.com/testing).
6. Acompanhe a mudança de status do pedido de `pending` para `paid`, que ocorre **exclusivamente após a confirmação do webhook**, e nunca pela resposta síncrona do navegador.

### Modo B: testes locais offline (sem conta no Stripe)

Caso queira validar os controles 2 e 3 sem criar uma conta no Stripe, você pode utilizar chaves de teste fictícias no `.env` (a aplicação requer que as variáveis existam, mas o simulador calcula as assinaturas localmente):

```env
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_local_dev_secret
```

```bash
# Terminal 1: inicia o servidor
npm start

# Terminal 2: cria um pedido pendente e envia webhooks assinados localmente
curl -X POST localhost:3000/api/orders -H "Content-Type: application/json" -d "{\"sku\":\"sku-areia\"}"
npx tsx simulator/send-test-webhook.ts order:<orderId>                     # confirma o pagamento do pedido
npx tsx simulator/send-test-webhook.ts order:<orderId>                     # reenvio do mesmo evento (retorna duplicated: true)
npx tsx simulator/send-test-webhook.ts order:<orderId> --tamper            # payload com alteração indevida (retorna status 400)
```

> Recomendamos executar o simulador com `npx tsx ...` para garantir que parâmetros como `--tamper` e `--event` sejam repassados corretamente pelo ambiente de linha de comando.

O simulador (`simulator/send-test-webhook.ts`) gera assinaturas seguindo rigorosamente o formato do Stripe (`Stripe-Signature: t=...,v1=HMAC-SHA256`). Dessa forma, ele exercita a mesma lógica de validação utilizada em produção.

> No Modo B, o formulário no navegador não renderiza os campos de cartão, pois o Stripe.js exige uma chave pública de teste válida (`pk_test_`). O controle 1 permanece coberto pelos testes automatizados e pela estrutura do código. Para testar a interface completa, utilize o Modo A.

### Executando com Docker

```bash
cp .env.example .env   # preencha com suas configurações de teste
docker compose up --build
```

A aplicação ficará disponível em `http://localhost:3000` com o banco SQLite persistido em um volume dedicado (`ares-data`). Os comandos do simulador do Modo B continuam funcionando normalmente.

Destaques da imagem (`Dockerfile`):

* Construção em múltiplos estágios (multi-stage build): o pacote `better-sqlite3` é compilado em uma etapa intermediária contendo as ferramentas necessárias (`python3`, `make` e `g++`), transferindo apenas os binários necessários para a imagem final (`node:22-slim`).
* Segurança na execução: o processo roda com usuário sem privilégios de administrador (`node`), com o diretório `/app/data` previamente configurado para assegurar as permissões do banco SQLite.

### Testes automatizados

```bash
npm test
```

A suíte de testes valida:
* Rejeição de requisições sem cabeçalho de assinatura
* Rejeição de requisições com assinatura válida mas conteúdo adulterado
* Confirmação de pagamento com garantia de idempotência em reenvios
* Proteção contra eventos divergentes em pedidos já finalizados
* Definição de valores cobrados estritamente pelo catálogo do servidor

---

## Arquitetura da solução

```
Navegador --(dados do cartão via iframe do Stripe)--> API Stripe        (Controle 1)
   │                                                     │
   │ client_secret                                       │ payment_intent.succeeded
   ▼                                                     ▼
Backend Express <============= Webhook ASSINADO =========┘              (Controle 2)
   │ validação de HMAC no corpo bruto
   │ INSERT em event_id (chave primária) impede duplicidade             (Controle 3)
   ▼
SQLite: pedido atualizado de pending para paid com trava de status
```

## Estrutura do projeto

```
src/
  server.ts            Inicialização do servidor HTTP
  app.ts               Configuração do Express e montagem dos middlewares
  config.ts            Carregamento e validação de variáveis de ambiente
  db.ts                Conexão SQLite e criação das tabelas
  stripe.ts            Instância do cliente oficial do Stripe
  types.ts             Definições de tipos compartilhados
  routes/checkout.ts   Criação de pedidos e PaymentIntents
  routes/webhook.ts    Validação de assinatura e controle de idempotência
public/                Interface web com Stripe.js e Payment Element
simulator/             Script para envio local de webhooks assinados
tests/                 Testes automatizados com node:test
tsconfig.json          Configuração do compilador TypeScript
```

## Uso de IA e dificuldades

O uso de IA neste projeto ficou restrito a três frentes:

1. **Escrita de documentação**: redação e revisão deste README e da descrição do Pull Request.
2. **Comentários no código**: auxílio na redação dos comentários que explicam os controles no código (por exemplo, o comentário em `src/routes/checkout.ts` sobre o motivo de o endpoint nunca receber dados de cartão).
3. **Programação assistida**: autocomplete e geração de trechos de código sob minha direção e revisão, dentro da arquitetura que eu havia definido.

As decisões de arquitetura e de segurança (escolha do gateway, os três controles, o modelo de dados e o desenho do fluxo de webhook) foram minhas; a IA não foi usada para tomá-las.

Dificuldades encontradas durante a implementação:

* **Corpo bruto antes do parser de JSON.** A verificação da assinatura do webhook depende do body *exatamente* como o Stripe o enviou. Montar o `express.json()` antes da rota de webhook corrompe o corpo (re-serialização) e quebra a validação de forma silenciosa: o problema só aparece quando um webhook legítimo é rejeitado. A solução foi registrar `express.raw()` para `/webhooks` antes do parser global em `src/app.ts`.
* **Compilação do `better-sqlite3` no Docker.** O pacote tem código nativo e a imagem final slim não possui as ferramentas de compilação. Exigiu um multi-stage build (`Dockerfile`) que compila na etapa de build e copia apenas os binários para `node:22-slim`.
* **Idempotência em duas camadas.** Não bastava confiar só na `Idempotency-Key` do Stripe: reenvios do webhook chegam como novas requisições sem chave. Foi preciso proteger as duas pontas: chave de idempotência na criação do PaymentIntent e chave primária em `event_id` no SQLite para o webhook (`src/routes/webhook.ts`).

O relato completo está na descrição do Pull Request.

## Licença

MIT
