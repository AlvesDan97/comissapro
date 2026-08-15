# ComissaPro

Central universal de vendas e comissões — solução completa (não MVP) para profissionais comissionados em uma ou várias empresas.

## O que está incluso

- Onboarding (nicho, 1 vs N lojas, primeira loja)
- Auth (login/registro, 2FA OTP demo, biometria toggle)
- Dashboard consolidado (comissão, recebida, pipeline, faturamento)
- Multilojas com motores: faixas, fixo, margem, tabela, caixa, marcos
- Snapshot histórico (RN-01) + versionamento de regras
- Vendas dinâmicas por nicho, split, recebíveis
- Pipeline de leads
- Simulador What-If
- Smart Reconciliation (upload PDF/Excel)
- Alisamento de renda
- Equipe / convites
- Trilha de auditoria
- Export CSV (contador)
- Offline queue (fila local + sync)
- Tema claro/escuro

## Como rodar

```bash
cd Backend
npm install
npm run seed
npm start
```

- Site (homepage + planos): [http://localhost:3847](http://localhost:3847)
- App: [http://localhost:3847/app](http://localhost:3847/app)
- Termos: [http://localhost:3847/termos](http://localhost:3847/termos)
- Privacidade: [http://localhost:3847/privacidade](http://localhost:3847/privacidade)
- Cookies: [http://localhost:3847/cookies](http://localhost:3847/cookies)
- Cancelamento: [http://localhost:3847/cancelamento](http://localhost:3847/cancelamento)
- Questionário: [http://localhost:3847/questionario](http://localhost:3847/questionario)

### Produção (Railway + Postgres)

Guia completo: [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md)

> Antes do lançamento comercial, substitua e-mails/CNPJ/razão social nos documentos legais e revise com um advogado.

### Planos

| Plano | Mensal | Anual |
|-------|--------|-------|
| Solo | R$ 49 | R$ 490 |
| Pro | R$ 89 | R$ 890 |
| Time | R$ 149 | R$ 1.490 |

### Conta demo

- E-mail: `marina.souza@exemplo.com`
- Senha: `demo1234`
- OTP (se 2FA ativo): `123456`

## Estrutura

```
Backend/          API Express + SQLite
Frontend/         SPA (HTML/CSS/JS)
```

## Segurança (implementação atual)

- Senhas com bcrypt
- JWT por usuário (isolamento multi-tenant nas queries)
- Logs de auditoria imutáveis (append-only)
- HTTPS/TLS e AES-256 em disco devem ser configurados no ambiente de produção (reverse proxy + disco cifrado)
