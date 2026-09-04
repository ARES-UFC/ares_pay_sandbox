# Estágio de compilação de dependências
# O better-sqlite3 necessita de ferramentas de compilação (python3, make e g++)
# em determinados ambientes. As dependências de desenvolvimento são removidas
# antes da cópia para a imagem final limpa.
FROM node:22-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm prune --omit=dev

# Estágio de execução
# A aplicação executa TypeScript diretamente a partir do código-fonte via tsx,
# sem necessidade de etapa de compilação separada.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src/ src/
COPY public/ public/

# Execução com usuário sem privilégios (node). O diretório /app/data é criado previamente
# com permissões apropriadas para assegurar o acesso do SQLite no volume.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

# O banco SQLite fica armazenado em /app/data, permitindo persistência via volume.
VOLUME ["/app/data"]

CMD ["npm", "start"]
