# Deploy Railway (piloto robusto ~500 usuários)

## O que foi preparado

- Front + API no mesmo serviço
- **Postgres** em produção (`DATABASE_URL`)
- SQLite só para desenvolvimento local (sem `DATABASE_URL`)
- Segurança: `helmet`, rate limit (login/API), CORS configurável, `JWT_SECRET` obrigatório em produção
- Health check: `GET /api/health`
- Dockerfile + `railway.toml`

## Passo a passo no Railway

1. Crie conta em https://railway.app e um **New Project**
2. **Add Postgres** (Add Service → Database → PostgreSQL)
3. **Add service** a partir do GitHub deste repositório (ou deploy do Dockerfile)
4. No serviço da app, conecte a variável `DATABASE_URL` do Postgres (Reference Variable)
5. Defina também:
   - `NODE_ENV=production`
   - `JWT_SECRET=` (string longa aleatória, 32+ chars)
   - `DATABASE_SSL=true`
   - `CORS_ORIGINS=https://seu-dominio.com.br,https://seu-app.up.railway.app`
6. Root / Dockerfile: use o `Dockerfile` na raiz do repo
7. Aguarde o deploy e abra a URL pública
8. (Opcional) rode seed **só para demo**:
   - Railway → service → shell / one-off: `node src/seed.js`
   - Em piloto real com clientes, **não** use a conta demo

## Domínio

1. Railway → Settings → Networking → Custom Domain
2. Aponte DNS (CNAME) do seu domínio para o host indicado
3. Atualize `CORS_ORIGINS` com o domínio final

## Local (dev)

```bash
cd Backend
cp .env.example .env
# deixe DATABASE_URL vazio → usa SQLite
npm install
npm run seed
npm start
```

### Local com Postgres (opcional)

```bash
docker compose up -d
# no Backend/.env:
# DATABASE_URL=postgresql://comiss:comiss@localhost:5432/comiss
# DATABASE_SSL=false
npm run seed
npm start
```

## Checklist de segurança do piloto

- [ ] `JWT_SECRET` forte e único
- [ ] `NODE_ENV=production`
- [ ] Postgres com backup automático (Railway)
- [ ] CORS só com seus domínios
- [ ] Conta demo desativada ou senha trocada
- [ ] HTTPS (Railway já fornece)
- [ ] Limite de gasto no Railway ativado
