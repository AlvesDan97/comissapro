# Fluxo contínuo: Git → Railway

## Repo único (monorepo)

GitHub: https://github.com/AlvesDan97/comissapro.git

```
comissapro/
├── Frontend/
├── Backend/
├── Dockerfile
├── railway.toml
└── docs/
```

## Variáveis no Railway (serviço da app)

| Variável | Valor |
|----------|--------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | string longa aleatória (32+ chars) |
| `DATABASE_URL` | Reference do Postgres |
| `DATABASE_SSL` | `true` |
| `CORS_ORIGINS` | URL pública do Railway (+ domínio depois) |

## Workflow

```bash
cd comissapro
git add -A
git commit -m "sua mudança"
git push origin main
```

Railway detecta o push e sobe front + API juntos.
