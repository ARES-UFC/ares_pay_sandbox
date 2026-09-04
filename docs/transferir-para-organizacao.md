# Transferindo o repositório para uma organização do GitHub

Este documento descreve, passo a passo, como mover este repositório
(`MarcosSMZ94/ares_pay_sandbox`) para uma organização do GitHub. A transferência é
operacional e não altera código, histórico de commits, issues, PRs ou tags.

## Pré-requisitos

1. **Criar (ou escolher) a organização.** Em <https://github.com/organizations/plan>:
   crie a organização com o nome desejado (ex.: `ares-pay`) e mantenha o plano **Free**,
   que já suporta repositórios privados e membros ilimitados.
2. **Permissão necessária.** Para transferir um repositório para a organização:
   * Você precisa ser **owner do repositório** (é o caso: você é o dono de `MarcosSMZ94/ares_pay_sandbox`); e
   * **Owner da organização de destino** (ou membro com permissão de criar repositórios, para receber a transferência).
3. **Restrições a checar antes** (itens que impedem ou se perdem na transferência):
   * O repositório não pode ter **GitHub Apps** instaladas que pertençam exclusivamente à conta pessoal;
   * **Pages** com domínio customizado precisa ser reconfigurado depois;
   * **Packages** (GitHub Packages) podem exigir re-publicação para o namespace da org;
   * Tags protegidas e branch rules são preservadas, mas **secrets/variables de Actions do repositório são transferidos**, então confira se nada de sensível deveria ser recriado no escopo da org.

## Opção 1: via interface web (recomendada)

1. Acesse o repositório: <https://github.com/MarcosSMZ94/ares_pay_sandbox>
2. Vá em **Settings** → aba **General**.
3. Role até o fim, na seção **Danger Zone**.
4. Clique em **Transfer ownership**.
5. Preencha:
   * *New owner*: o nome da organização (ex.: `ares-pay`);
   * *Validate*: digite o nome do repositório (`ares_pay_sandbox`) para confirmar.
6. Confirme. O GitHub envia um e-mail de confirmação; a transferência se completa
   quando aceita (ou imediatamente, se você for owner das duas pontas).

## Opção 2: via `gh` CLI

```bash
# Autenticado como dono atual do repositório
gh auth status

# Dispara a transferência (requer permissão de owner na organização de destino)
gh api --method POST /repos/MarcosSMZ94/ares_pay_sandbox/transfer \
  -f new_owner=NOME-DA-ORG

# Alternativa: criar na org um novo repo e espelhar (preserva branches e tags, mas zera issues/PRs)
git clone --mirror https://github.com/MarcosSMZ94/ares_pay_sandbox.git
cd ares_pay_sandbox.git
git push --mirror https://github.com/NOME-DA-ORG/ares_pay_sandbox.git
```

> Prefira a transferência nativa (opção 1 ou o `gh api` acima) ao espelhamento: ela
> preserva issues, Pull Requests, stars e watchers. O espelhamento é plano B quando
> a transferência não está disponível.

## Pós-transferência

1. **Redirects automáticos.** O GitHub redireciona a URL antiga
   (`github.com/MarcosSMZ94/ares_pay_sandbox`) para a nova. Redirects quebram se um
   repositório com o mesmo nome for criado na conta antiga.
2. **Atualizar o remote local:**

   ```bash
   git remote set-url origin https://github.com/NOME-DA-ORG/ares_pay_sandbox.git
   git remote -v   # confirme a nova URL
   ```

3. **Revisar configurações na org:**
   * Branch protection em `main` e demais branches (conferir se as regras vieram corretas);
   * Webhooks (inclusive o endpoint de webhook do Stripe em ambiente de teste, se configurado);
   * Convidar colaboradores como membros da org e atribuir papéis;
   * Ajustar visibilidade padrão e permissões de base em **Org Settings → Member privileges**.
4. **CI/CD.** Workflows de Actions continuam funcionando; confira se algum workflow
   referenciava o login antigo por URL.
