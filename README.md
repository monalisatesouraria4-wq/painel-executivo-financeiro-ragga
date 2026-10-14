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

Schema definido em `apps/web/lib/db/schema/*.ts`. Os arquivos SQL ficam em
`supabase/migrations/` (pasta de saída do Drizzle Kit — não é o mecanismo de
migrations da CLI do Supabase; não há `config.toml` nem o schema
`supabase_migrations`), com o seed em `supabase/seed/`:

| Migration | Conteúdo |
|---|---|
| `0000_schema_inicial.sql` | tabelas de fato, dimensão, controle e gestão |
| `0001_rls.sql` | Row Level Security (escrita à mão) |
| `0002_lonely_zaran.sql` | `tratativas.data_ocorrencia` |
| `0003_cancelamento_salao_detalhe.sql` | detalhe individual dos estornos do Cancelamento Salão (índice parcial, RLS e policy; idempotente) |

**Como as migrations são aplicadas hoje: manualmente, sem rastreamento no banco.**
O banco compartilhado (Supabase) recebeu cada SQL por fora do `drizzle-kit
migrate`; a tabela de controle `drizzle.__drizzle_migrations` existe, mas está
**vazia** — nenhuma migration (0000 a 0003) está registrada nela. O deploy na
Vercel roda apenas `next build`: **nenhum passo de migration é executado no
deploy**. Por isso:

- **Não rode `npm run db:migrate` contra o banco compartilhado** sem antes
  registrar a referência (baseline) em `drizzle.__drizzle_migrations`: sem ela,
  o Drizzle tentaria reaplicar a 0000 (as tabelas já existem) e falharia.
- Os arquivos `meta/_journal.json` e `meta/NNNN_snapshot.json` servem ao
  `db:generate` (diff do schema); eles refletem o schema atual (até a 0003) e
  não o estado do banco.

Para uma nova migration: editar `apps/web/lib/db/schema/*.ts`, rodar
`npm run db:generate` (não conecta ao banco), revisar o SQL gerado, aplicá-lo
manualmente no banco (ou nas rotinas aprovadas) e fazer o commit do `.sql`, do
`_journal.json` e do novo snapshot. Para um banco novo: copiar
`apps/web/.env.example` para `apps/web/.env.local`, preencher `DATABASE_URL`,
aplicar os SQL de `supabase/migrations/` em ordem e rodar os scripts de
`supabase/seed/` (17 unidades + parâmetros de semáforo aprovados).

## Estado do projeto / próximas etapas

1. ✅ **Etapa 1 — Fundação.**
2. ✅ **Etapa 2 — Schema do banco** (tabelas de fato, dimensão,
   `fontes_por_periodo`, perfis/usuários, RLS, seed). Schema definido e
   migrations geradas; **aplicadas manualmente ao banco compartilhado
   (Supabase)**, inclusive a 0003 (`cancelamento_salao_detalhe`). As migrations
   **não estão registradas** em `drizzle.__drizzle_migrations`, que permanece
   vazia (ver "Banco de dados (Supabase)").
3. ⏳ Etapa 3 — Motor de importação (parsers, `resolverAba`, upsert/delete+insert).
4. ⏳ Etapa 4 em diante — telas (Visão Geral, Comparativo, Indicadores,
   Controles de Caixa, Análise Gerencial, Plano de Ação, Fechamentos),
   autenticação real, migração final do painel HTML atual.

O painel HTML atual permanece a referência funcional e visual até que
paridade completa seja validada.
