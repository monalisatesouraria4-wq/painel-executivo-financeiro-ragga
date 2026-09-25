# Painel Executivo Financeiro — Ragga Gestão

Evolução do atual Painel Executivo Financeiro (HTML com dados embutidos)
para uma aplicação web com banco de dados permanente, usada pelo
Financeiro/Administrativo do Grupo Londrino/Ragga para acompanhamento
financeiro e operacional das 17 unidades.

> Estado atual: **Etapa 1 — Fundação do projeto.** Sem dados reais
> importados, sem telas completas, sem migração do painel HTML antigo.

## Arquitetura

```
Usuário (desktop/mobile)
        │
   Next.js (App Router, TypeScript) ── Vercel
        │  API routes / server actions
        ▼
   PostgreSQL (Supabase) + Auth + Storage
```

- **Frontend/Backend:** Next.js (App Router) + TypeScript, deploy na Vercel.
- **UI:** Tailwind CSS, com tokens da identidade visual Ragga.
- **Banco:** PostgreSQL via Supabase (Auth + RLS desde a fundação).
- **ORM/Migrations:** Drizzle ORM + Drizzle Kit.
- **Testes:** Vitest (unitário, regras de negócio) + Playwright (E2E).

Detalhes completos do planejamento e das regras de negócio aprovadas:
[docs/regras-negocio.md](./docs/regras-negocio.md).

## Estrutura de pastas

```
.
├─ apps/
│  └─ web/                      # aplicação Next.js
│     ├─ app/
│     │  ├─ (dashboard)/        # Visão Geral, Comparativo, Indicadores,
│     │  │                        Controles de Caixa, Análise Gerencial,
│     │  │                        Plano de Ação, Fechamentos
│     │  ├─ (admin)/importacao/
│     │  └─ api/                # rotas de importação, indicadores, tratativas
│     ├─ components/
│     ├─ lib/
│     │  ├─ db/                 # clientes Supabase/Drizzle, schema (Etapa 2)
│     │  ├─ import/             # parsers por tipo de base (Etapa 3)
│     │  ├─ rules/              # regras de negócio centralizadas
│     │  └─ calc/                # motor de indicadores/comparação (próximas etapas)
│     └─ tests/
│        ├─ unit/               # Vitest — regras de negócio
│        └─ e2e/                # Playwright
├─ packages/
│  └─ shared/                   # tipos e constantes compartilhados (unidades, perfis, tipos de base)
├─ supabase/
│  ├─ migrations/                # geradas pelo Drizzle Kit
│  └─ seed/
├─ docs/
│  └─ regras-negocio.md         # regras de negócio aprovadas (fonte de verdade)
└─ .github/workflows/            # CI
```

## Regras de negócio centralizadas

Toda regra de data, período, semáforo, deduplicação e importação vive em
`apps/web/lib/rules/` — nenhuma tela reimplementa essas regras localmente.
Ver [docs/regras-negocio.md](./docs/regras-negocio.md) para o detalhamento
de cada regra e o mapeamento para o arquivo que a implementa.

## Como rodar

Pré-requisitos: Node.js 24+, npm 11+.

```bash
npm install
npm run dev        # inicia apps/web em http://localhost:3000
npm run lint
npm run typecheck
npm run test        # testes unitários (Vitest)
npm run build
```

Testes E2E (Playwright) exigem os browsers instalados uma vez:

```bash
npx playwright install --with-deps
npm run test:e2e
```

### Banco de dados (Supabase)

Schema definido em `apps/web/lib/db/schema/*.ts`, com migration gerada em
`supabase/migrations/` (`0000_schema_inicial.sql` + `0001_rls.sql`) e seed
em `supabase/seed/`. **Nada disso foi aplicado em um banco real ainda** —
nenhum projeto Supabase está conectado.

Quando houver um projeto Supabase para conectar:

1. Copiar `apps/web/.env.example` para `apps/web/.env.local` e preencher
   com as credenciais do projeto Supabase (`DATABASE_URL`, etc.).
2. Aplicar as migrations em `supabase/migrations/` (via `npm run db:migrate`
   ou pela CLI/dashboard do Supabase).
3. Rodar os scripts de `supabase/seed/` (17 unidades + parâmetros de
   semáforo aprovados).
4. Alterações futuras ao schema: editar `apps/web/lib/db/schema/*.ts` e
   rodar `npm run db:generate` para gerar a próxima migration.

## Estado do projeto / próximas etapas

1. ✅ **Etapa 1 — Fundação.**
2. ✅ **Etapa 2 — Schema do banco** (tabelas de fato, dimensão,
   `fontes_por_periodo`, perfis/usuários, RLS, seed). Schema definido e
   migration gerada, **ainda não aplicada em nenhum banco real** (este momento).
3. ⏳ Etapa 3 — Motor de importação (parsers, `resolverAba`, upsert/delete+insert).
4. ⏳ Etapa 4 em diante — telas (Visão Geral, Comparativo, Indicadores,
   Controles de Caixa, Análise Gerencial, Plano de Ação, Fechamentos),
   autenticação real, migração final do painel HTML atual.

O painel HTML atual permanece a referência funcional e visual até que
paridade completa seja validada.
