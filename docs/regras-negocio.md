# Regras de Negócio — Painel Executivo Financeiro (Ragga Gestão)

> Documento vivo. Espelha as regras aprovadas no planejamento técnico
> (v1 e v2). Qualquer alteração de regra deve ser aprovada explicitamente
> antes de mudar este arquivo ou o código que o implementa.

## Unidades (17)

BG 01, BG 02, BG 03, BG 04, BG 05, BG 06, BG 07, BG 08 E 09, BG 10, BG 11,
BG 12, BG 13, IS 01, IS 02, IS 03, ROBS, MAPOLI.

**Confirmado com dados reais (Etapa 2):** BG 08 E 09 é uma única unidade —
não existe BG 09 separado. Não existem BG 14 a BG 18 (aparecem apenas em
listas antigas). O seed em `supabase/seed/0001_unidades.sql` cadastra
exatamente estas 17.

Fonte única no código: `packages/shared/unidades.ts`.

## Regras de Data

| Base | Regra |
|---|---|
| Brindes | D-1 |
| Cancelamentos (Salão/Delivery) | D-1 |
| Compra Direta | D-1 |
| Retirada Depósito | D-1 |
| Fechamento de Caixa | data selecionada |
| PDV × Maquininha | D-2 |
| Conferência | D-2 |
| Troco | semana real correspondente ao período selecionado |

Implementado em `apps/web/lib/rules/datas.ts`.

## Regras Importantes por Base

- **Fechamento de Caixa:** não deduplicar. Uma loja pode ter mais de uma
  movimentação. Chave de referência (validação/auditoria, não dedup):
  filial + data + movimento. **Confirmado com dados reais (Etapa 2):**
  não usar "caixa" na chave — filial + data + caixa causava perda de
  registros legítimos.
- **Brindes:** chave: filial + data + motivo + motivo2.
- **Faturamento:** chave: filial + data.
- **Compra Direta:** chave: filial + data + motivo.
- **Cancelamento Salão:** chave: filial + data + motivo.
- **Cancelamento Delivery:** chave: filial + data + motivo.
- **PDV × Maquininha:** chave: filial + data + forma_pagamento.
- **Formas de pagamento:** chave: filial + data + forma.
- **Conferência:** chave: filial + data + tipo.
- **Retirada Depósito:** NÃO deduplicar. Cada lançamento é um registro.
  Reimportação de um período substitui apenas o período enviado.
- **Troco:** NÃO deduplicar. Registros repetidos são legítimos.
  Reimportação de um período substitui apenas o período enviado.
  Usa as datas reais da semana. Não inventar tolerância. Não alterar registros originais.
- **Quebra de Caixa:** NÃO deduplicar. Lançamentos repetidos são legítimos.
  Reimportação de um período substitui apenas o período enviado.

Implementado em `apps/web/lib/rules/deduplicacao.ts` e `chaves.ts`.

## Conferência

- `0` = conferido/normal.
- `X` = marcado manualmente como atraso.
- vazio = não lançado/não conferido.
- **Completa** = Conferido = Total.
- **Parcial** = Conferido < Total.
- **Inconsistente** = Conferido > Total.
- **Pendente** = Total - Conferido.
- **Em atraso** quando aplicável pela regra D-2/global de referência.
- **MAPOLI não possui conferência aos finais de semana.**

Implementado (esqueleto, a validar na Etapa 3) em `apps/web/lib/rules/conferenciaStatus.ts`.

## Depósito

- Segunda a quinta → depósito na sexta.
- Sexta a domingo → depósito na segunda.

Implementado em `apps/web/lib/rules/deposito.ts`.

## Semáforos Atuais

**Cancelamento Salão/Delivery**
- ≤ 0,50% = azul
- ≤ 1,00% = verde
- ≤ 2,00% = amarelo
- \> 2,00% = vermelho

**Brindes**
- ≤ 0,25% = azul
- ≤ 0,40% = amarelo
- \> 0,40% = vermelho

**Compra Direta**
- ≤ 5,00% = verde
- ≤ 7,00% = amarelo
- \> 7,00% = vermelho

Implementado em `apps/web/lib/rules/semaforos.ts`. Faixas parametrizáveis
futuramente via tabela `parametros_semaforo` (Etapa 2) — os valores acima
são o default aprovado.

## Resolução de Aba por Período (Conferência e Quebra de Caixa)

A base de **Status de Conferência de Caixa** e a base de **Quebra de Caixa**
são arquivos organizados por abas, cada uma cobrindo um período de datas
(ex.: `"16.08 a 15.09"`, `"QUEBRA 16-09 A 15-10"`).

- O sistema **não assume uma aba fixa**.
- Ao selecionar uma data, o motor identifica automaticamente qual aba
  cobre essa data (`periodo_inicio <= data <= periodo_fim`).
- Se **nenhuma aba** corresponder: erro claro, nenhuma suposição.
- Se **mais de uma aba** corresponder: erro de ambiguidade, nunca escolha
  arbitrária.
- **Conferência e Quebra de Caixa possuem resolvedores independentes** —
  a aba resolvida para uma nunca é reaproveitada para a outra, mesmo que
  os períodos coincidam na maioria dos casos.
- A aba utilizada em cada importação/leitura é registrada na auditoria.

Implementado em `apps/web/lib/rules/resolverAba.ts`.

## Modelo de Importação: Arquivo → Aba → Dados

Toda importação registra, quando aplicável: arquivo, tipo de base, aba
utilizada, período da aba, período dos dados, usuário, data/hora,
quantidade de registros, erros/avisos. (Tabela `importacoes` — Etapa 2.)

## Autenticação e Permissões

Perfis previstos desde a fundação do schema (Etapa 2), mesmo que apenas
`financeiro_master` seja usado nesta etapa:

- `admin`
- `financeiro_master`
- `financeiro`
- `gestor_regional`
- `gestor_loja`

Supabase Auth + RLS no PostgreSQL desde a fundação. Estrutura para
restringir unidades visíveis por usuário (`usuario_unidade`) prevista no
schema, sem tela de administração nesta etapa.

Implementado em `packages/shared/perfis.ts` (constantes de perfil).

## Regras Centralizadas (não duplicar por tela)

Único ponto de verdade para cada regra, em `apps/web/lib/rules/`:

- `datas.ts` — D-1, D-2, semana real.
- `resolverAba.ts` — resolução de aba por período (Conferência, Quebra de Caixa).
- `semaforos.ts` — thresholds por indicador.
- `deduplicacao.ts` — estratégia de gravação (upsert vs delete+insert) por base.
- `chaves.ts` — chave lógica de cada base.
- `deposito.ts` — regra de data de depósito.
- `conferenciaStatus.ts` — status de conferência (Completa/Parcial/Inconsistente/Pendente/Em atraso).

## Identidade Visual

- Azul principal: `#2B4899`
- Azul escuro: `#1F3570`
- Fundo claro: `#EDF1F8`
- Superfície branca: `#FFFFFF`

Tokens em `apps/web/app/globals.css` (`--ragga-blue`, `--ragga-blue-dark`,
`--ragga-bg`, `--ragga-surface`, além das cores de semáforo).

## Paridade com o Painel Atual

O painel HTML atual continua sendo a referência funcional e visual durante
a migração. Nenhuma tela nova é considerada pronta até bater com o painel
atual, nos mesmos dados/período. Nenhuma regra existente é descartada sem
validação explícita — divergência é tratada como bug a investigar.

## Schema do Banco (Etapa 2)

Implementado em `apps/web/lib/db/schema/*.ts` (Drizzle ORM), migration
gerada em `supabase/migrations/0000_schema_inicial.sql` (19 tabelas) e
`supabase/migrations/0001_rls.sql` (Row Level Security). **Nenhuma
migration foi aplicada em banco real** — não há projeto Supabase
conectado ainda (`DATABASE_URL` não configurada). Seed em
`supabase/seed/` (17 unidades + parâmetros de semáforo aprovados).

Estrutura: dimensão (`unidades`, `usuarios`, `usuario_unidade`),
auditoria/importação (`fontes_por_periodo`, `importacoes`), 8 tabelas de
fato com chave única (`faturamento`, `brindes`, `cancelamento_salao`,
`cancelamento_delivery`, `compra_direta`, `pdv_maquininha`,
`formas_pagamento`, `conferencia`), 4 tabelas de fato sem dedup
(`fechamento_caixa`, `retirada_deposito`, `troco`, `quebra_caixa`) e
gestão (`parametros_semaforo`, `tratativas`).

`conferencia` e `quebra_caixa` têm `fonte_periodo_id` referenciando
`fontes_por_periodo`, que guarda `tipo_base` + `arquivo_nome` + `nome_aba`
+ `periodo_inicio` + `periodo_fim` — cada uma das duas bases cadastra suas
próprias abas, nunca compartilhadas (planejamento v2, itens 1 e 2).

RLS habilitado em todas as tabelas desde a fundação. Perfis `admin` e
`financeiro_master` têm acesso total; demais perfis (ainda não usados)
seriam restritos por `usuario_unidade`. **Policies de escrita
(INSERT/UPDATE/DELETE) não foram criadas nesta etapa** — a
importação/gravação é feita pelo backend com a service role key, que
ignora RLS. Policies de escrita para o Plano de Ação (usuários
autenticados criando/editando tratativas) ficam para quando essa tela for
implementada.

## Pendências de Validação (não são decisões tomadas, apenas registradas)

- `conferenciaStatus.ts` contém uma ordem de precedência entre os status
  (Inconsistente > Completa > Em atraso > Parcial > Pendente) que é uma
  interpretação inicial das regras aprovadas para permitir o esqueleto
  dos testes. **Esta ordem de precedência ainda não foi validada
  explicitamente** e deve ser confirmada antes de ser usada com dados
  reais (Etapa 3).
- `tratativas.status` não tem um conjunto fechado de valores definido no
  planejamento (apenas "status" foi mencionado). O schema deixa o campo
  como texto livre com default `'aberto'`, sem `CHECK` de valores válidos,
  até que os status do Plano de Ação sejam definidos explicitamente.
- Precisão numérica: todos os valores monetários foram definidos como
  `numeric(14,2)` (decisão técnica padrão, não uma regra de negócio
  informada) — sinalizar se algum valor exigir mais casas decimais.
- `parametros_semaforo`: a última faixa de cada indicador (">") é
  representada com um teto alto (`999999.99`) em vez de "sem limite", por
  ser mais simples de consultar; equivalente a `Infinity` usado em
  `apps/web/lib/rules/semaforos.ts`.
