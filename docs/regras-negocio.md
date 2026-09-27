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
  filial + data + caixa + movimento. **Corrigido/confirmado com dados
  reais (Etapa 2):** filial + data + caixa (sem movimento) gerava 16
  duplicidades; filial + data + caixa + movimento gerou zero — "caixa"
  precisa permanecer na chave, pois dois caixas da mesma filial podem ter
  o mesmo movimento na mesma data. **Confirmado (levantamento pós-Etapa
  3):** a fonte real não tem valor monetário — o schema guarda os campos
  reais (Abertura, Fechamento, Operador, Situação, Dif. fech., Dif.
  conc., Dif. total), sem coluna "valor".
- **Troco:** guarda os DOIS valores da fonte real separadamente —
  `troco_conferido_gerente` e `troco_informado_colaborador` — mais a
  `diferenca` entre eles, sem escolher apenas um (levantamento pós-Etapa
  3). Não deduplicar; reimportação de um período substitui apenas aquele
  período.
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

## Motor de Importação (Etapa 3)

Implementado em `apps/web/lib/import/`, rodando **apenas local/teste** —
sem conexão com Supabase e sem carga definitiva. Arquitetura: detecção do
tipo de base pela estrutura do cabeçalho (`detector.ts`, não pelo nome do
arquivo), normalização de unidade (`normalizarUnidade.ts`, cobre BG 08 E 09
como unidade única e a nomenclatura alternativa "BIGGS NN - Nome" vista em
`RETIRADA DEPOSITO NOVO.xlsx`), parsers por base (`parsers/listaSimples.ts`
genérico + `parsers/quebraCaixa.ts` específico), relatório de validação
(`relatorio.ts`) e simulação de gravação (`simularGravacao.ts`, upsert por
chave ou delete-do-período+insert, sem tocar banco real).

**Bases com parser pronto e testado contra os arquivos reais:** brindes,
cancelamento_salao, cancelamento_delivery, compra_direta, quebra_caixa,
faturamento, pdv_maquininha, retirada_deposito, **fechamento_caixa**,
**troco**.

**Base com pendência (parser NÃO finalizado — schema atual não reflete o
modelo real confirmado, ver "Divergência: Conferência" abaixo):**
conferência.

### Normalização de unidade — generalizada (Etapa 4)

`normalizarUnidade.ts` deixou de ser uma lista fixa de nomes e passou a
espelhar fielmente `normalizeFilialJS` do painel HTML atual (regex
genérica para `BG NN`/`BIGGS NN`/`IS NN`/`ISAIAS NN`, mais `CASARIA` →
`MAPOLI`). Necessário porque o arquivo real de Fechamento de Caixa usa
`"ISAIAS 01 - MARINGA"`, um padrão que a lista fixa anterior não cobria
— mas que o painel oficial já reconhece, então isso não é uma regra
nova. **Mudança de comportamento correspondente:** `"BG 09"` e `"BG 08"`
isolados agora são aceitos e dobrados em `BG 08 E 09` (antes eram
rejeitados) — replica exatamente o que `normalizeFilialJS` já faz em
produção.

### Fechamento de Caixa e Troco — parsers implementados

Implementados em `apps/web/lib/import/parsers/fechamentoCaixa.ts` e
`troco.ts`, preservando exatamente a estrutura e as regras já aprovadas
(sem valor monetário em fechamento_caixa; os dois valores separados —
`troco_conferido_gerente`/`troco_informado_colaborador` — em troco).

- **Fechamento de Caixa:** `RegistroBase.valor` usa `0` como placeholder
  (a base não tem valor monetário); os campos reais (Abertura,
  Fechamento, Operador, Situação, as 3 diferenças) ficam em `extras`.
  Chave de auditoria filial+data+caixa+movimento usada só para o
  relatório de colisões, nunca para descartar linhas — confirmado no
  dry-run: 0 colisões reportadas para uma base sem-dedup, como esperado.
- **Troco:** a coluna "Diferença" é uma fórmula de tabela do Excel sem
  resultado cacheado na maioria das linhas reais (1.547 de 1.630) — em
  vez de depender desse cache ausente, o parser recalcula
  `diferenca = trocoConferidoGerente - trocoInformadoColaborador`,
  exatamente a mesma subtração que a fórmula da planilha descreve (não
  é uma regra nova). Colunas reais "OPERADOR" e "PLANO DE AÇÃO" não têm
  campo correspondente no schema aprovado — não persistidas nesta etapa
  (pendência leve, sinalizada, não bloqueante).

**Dry-run contra os arquivos reais (sem gravar nada):**

| Base | Arquivo | Lidos | Válidos | Rejeitados | Totais | Período |
|---|---|---|---|---|---|---|
| Fechamento de Caixa | `FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx.xlsx` | 1.385 | 1.385 | 0 | Situação: Conciliado 1.066, Fechado 318, Aberto 1 | 01/09 a 24/09/2026 |
| Troco | `TROCO SEMANAL.xlsx` | 1.630 | 1.627 | 3 (1 caixa vazio, 2 com célula-fórmula sem valor numérico no próprio troco conferido/informado) | Conferido R$ 2.113.141,83 / Informado R$ 2.113.516,11 / Diferença −R$ 374,28 (75 de 1.627 registros com diferença ≠ 0) | 08/04 a 23/09/2026 |

Ambas as bases cobrem as 17 unidades.

### Faturamento, PDV × Maquininha e Retirada Depósito — parsers implementados

Implementados em `apps/web/lib/import/parsers/faturamento.ts`,
`pdvMaquininha.ts` e `retiradaDeposito.ts`, seguindo exatamente as regras
já confirmadas a partir do painel HTML atual (ver seção "Regras
Confirmadas a partir do Painel Atual"). Nenhuma regra nova foi criada.

- **Faturamento:** agrega `SUM(Vl. pagamento)` por Filial+Data já no
  parser (a granularidade bruta do arquivo é por cupom/forma de
  pagamento — muito mais fina que a base `faturamento`). Sem exclusão de
  cancelamento ou valores negativos (mesmo comportamento do painel
  atual — pendência de saber se isso é correto continua registrada
  abaixo).
- **PDV × Maquininha:** lê a aba `Export` do arquivo oficial; ignora
  linhas de totalizador (`"TOTAL"`); guarda PDV, Maquininha e Diferença
  sem recalcular.
- **Retirada Depósito:** reaproveita `parseListaSimples` (nova entrada
  `retirada_deposito` em `CONFIGS_LISTA_SIMPLES`) e filtra depois só as
  linhas com `Motivo = "DEPOSITO"` — as demais ficam nos "rejeitados" com
  motivo explícito (ex. `Motivo = "SUPRIMENTO" — fora do escopo`), não
  descartadas silenciosamente.

O `detector.ts` ganhou a assinatura de `retirada_deposito` (exige
`Motivo` E `Motivo/Descrição` como colunas separadas — só o arquivo
oficial `Retirada Depósito.xlsx` bate; a aba "coud" e demais candidatos
continuam retornando `null`, sem serem confundidos).

**Dry-run contra os arquivos reais (sem gravar nada), item a validar:**

| Base | Arquivo/aba | Lidos | Válidos | Rejeitados/excluídos | Soma | Período |
|---|---|---|---|---|---|---|
| Faturamento | `FATURAMENTO - 1 SEMESTRE 2026.xlsx` | 648.989 linhas brutas | 2.392 registros (filial+data) | 0 | R$ 32.308.466,70 | 01/02 a 30/06/2026 |
| PDV × Maquininha | `PDV X Adquirente - Consolidado.xlsx` / Export | 1.306 | 1.306 | 0 | PDV R$ 2.482.663,93 / Maquininha R$ 2.473.602,78 / Dif. −R$ 9.061,15 | 01/09 a 20/09/2026 |
| Retirada Depósito | `Retirada Depósito.xlsx` | 55 | 9 (Motivo=DEPOSITO) | 46 (outras classificações, ex. SUPRIMENTO/ERRO) | R$ 6.520,00 | 15/09 a 24/09/2026 |

**Correção (bug do parser, não da fonte):** o dry-run inicial de PDV ×
Maquininha reportou 973 "colisões de chave" — o usuário confirmou
diretamente no Excel que `Loja+Data+Forma de Pag.` é 100% única nas
1.306 linhas do arquivo real. Investigado: `parsePdvMaquininha` gravava
a forma de pagamento em `extras.forma`, mas
`CHAVES_POR_BASE.pdv_maquininha` (lib/rules/chaves.ts) espera
`extras.forma_pagamento` — como `gerarRelatorioImportacao` lê o campo
pelo nome definido em `CHAVES_POR_BASE`, o campo não era encontrado,
virava string vazia para toda linha, e a chave efetiva colapsava para
só `filial+data` — cada grupo de até 4 formas do mesmo dia aparecia como
"colidindo" entre si (973/1306 ≈ 74,5%, compatível com 3 de cada 4
formas colidindo com a 1ª). Corrigido renomeando o campo para
`forma_pagamento` em `apps/web/lib/import/parsers/pdvMaquininha.ts`.
Nenhuma linha foi descartada em nenhum momento — a contagem de colisões
é só diagnóstico, nunca influenciou o parsing. Nenhuma regra de
deduplicação foi criada ou alterada. Reexecutado o dry-run após a
correção: **0 colisões**, confirmando `UNIQUE(Loja+Data+Forma de Pag.)`
como já era esperado. Teste de regressão adicionado em
`tests/unit/pdvMaquininha.test.ts`.

**Total por forma de pagamento (dry-run corrigido):** Crédito 333,
Débito 333, Pix 327, Voucher 313 — soma 1.306, batendo com o total de
linhas válidas.

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

### Pendências encontradas na Etapa 3 (motor de importação) — bloqueiam o parser final das bases abaixo

- **Conferência — modelo de dados: CONFIRMADO, mas DIVERGE do schema
  atual — parser NÃO implementado, aguardando decisão.** O modelo real
  (confirmado pelo usuário) é uma contagem diária agregada por filial:
  dentro da aba resolvida, cada linha é uma filial, com colunas
  `Resp. pela Conferência`, `Filial`, `Qtd. caixas` (total cadastrado) e
  depois uma coluna por dia do período, cujo valor é a quantidade de
  caixas conferidos naquele dia. Não existe "tipo" nem marcação por
  caixa individual (0/X/vazio).

  O schema atual (`apps/web/lib/db/schema/fatosComDedup.ts`, tabela
  `conferencia`) ainda reflete o modelo ANTIGO (por caixa): tem colunas
  `tipo` (não existe na fonte real), `marcacao` (0/X/vazio — não existe
  na fonte real) e uma constraint única em `(unidade_id, data, tipo)`.
  Nenhuma dessas 3 colunas faz sentido para o modelo confirmado.

  Para caber no modelo real, o schema precisaria de algo como
  `unidade_id + data + qtd_cadastrados + qtd_conferidos` (chave única em
  `unidade_id + data`, sem `tipo`) — mas isso é uma alteração de schema
  que ainda não fiz, conforme pedido ("se encontrar divergência, pare e
  apresente antes de decidir"). **Não implementei o parser nem alterei o
  schema desta base — aguardando sua decisão.**

- **Conferência — resolução de aba por período: RESOLVIDA.** Implementada
  em `apps/web/lib/import/periodoAbaConferencia.ts` +
  `resolverAbaConferencia.ts`. O período de cada aba (com ano) é extraído
  da própria planilha — a linha 6 de cada aba de Conferência tem uma
  coluna por dia do período, com o valor sendo uma data completa do Excel
  (ex.: aba "16.09 a 15.10" → linha 6 vai de `2026-09-16` a `2026-10-15`).
  O nome da aba nunca é usado para decidir o período; ele só serve para
  saber quais abas existem no arquivo. Uma aba só é aceita como válida
  quando a linha 6 é uma sequência de datas reais, consecutivas dia a
  dia — isso identifica corretamente a aba real `"16-10 A 15-09"` como
  **inválida** (sua linha 6 tem a estrutura de Quebra de Caixa —
  fórmula/texto, não datas — porque na prática essa aba é um resquício de
  cópia mal nomeado), sem tentar corrigi-la ou adivinhar o que ela
  deveria significar, conforme pedido.

  **Achado nos dados reais:** existe um buraco de 1 dia entre as abas do
  arquivo: a aba `"16.10 a 15.11"` termina em `2026-11-14` (não 15, como o
  nome sugere) e a aba `"16.11 a 15.12"` começa em `2026-11-16` — o dia
  `15/11/2026` não é coberto por nenhuma aba. O sistema retorna erro claro
  para essa data (não inventa cobertura). Sinalizo para sua ciência; não
  corrigi o arquivo nem o resolvedor para "tapar" esse buraco.
- **Fechamento de Caixa — RESOLVIDA, parser implementado (Etapa 4).**
  Confirmado: sem campo de valor monetário. Schema com os campos reais
  (Abertura, Fechamento, Operador, Situação, Dif. fech., Dif. conc.,
  Dif. total) — ver `apps/web/lib/db/schema/fatosSemDedup.ts` e
  `apps/web/lib/import/parsers/fechamentoCaixa.ts`.
- **Troco — RESOLVIDA, parser implementado (Etapa 4).** Confirmado:
  gravar os dois valores separadamente. Schema com
  `troco_conferido_gerente`, `troco_informado_colaborador`, `diferenca`
  e `caixa` — ver `apps/web/lib/db/schema/fatosSemDedup.ts` e
  `apps/web/lib/import/parsers/troco.ts`.
- **Retirada Depósito — RESOLVIDA.** Fonte oficial confirmada a partir do
  painel HTML atual (ver seção "Regras Confirmadas a partir do Painel
  Atual" abaixo): `Retirada Depósito.xlsx`, considerando apenas linhas
  com `Motivo = "DEPOSITO"`. As demais abas/arquivos investigados
  (`RETIRADA DEPOSITO.xlsx` com suas 7 abas, `RETIRADA DEPOSITO NOVO.xlsx`)
  **não alimentam** o indicador atual — não foram unificados nem tratados
  como a mesma base.
- **PDV × Maquininha — RESOLVIDA.** Fonte oficial confirmada:
  `PDV X Adquirente - Consolidado.xlsx`, aba `Export`. `banco x maquina.xlsx`
  **não é usado** pelo painel atual.
- **Faturamento — RESOLVIDA.** Regra oficial confirmada:
  `SUM(Vl. pagamento) GROUP BY Filial, Data` a partir do arquivo no
  formato de `CONCILIAÇÃO/BG 01/FATURAMENTO - 1 SEMESTRE 2026.xlsx`
  (colunas Filial/Data/Desc. pagam./Vl. pagamento), sem exclusão de
  cancelamento ou de valores negativos — é exatamente o que o painel
  atual já faz.
- **Nomenclatura de unidade "BIGGS NN"/"ISAIAS NN" — RESOLVIDA (Etapa 4).**
  `normalizarUnidade.ts` agora usa a mesma lógica genérica por regex do
  painel HTML atual (`normalizeFilialJS`), em vez de uma lista fixa de
  nomes — cobre qualquer `"BIGGS NN"`/`"ISAIAS NN"` (com ou sem sufixo de
  nome da loja), não só os 11 nomes vistos antes. Confirmado contra
  `FECHAMENTO DE CAIXA...xlsx`, que usa `"ISAIAS 01 - MARINGA"`.
- **Nomenclatura de unidade "CASARIA" → MAPOLI: RESOLVIDA.** Confirmado
  pelo usuário e adicionado a `apps/web/lib/import/normalizarUnidade.ts`
  — ver seção "Investigação: CASARIA → MAPOLI" abaixo.

## Regras Confirmadas a partir do Painel Atual (HTML)

Fonte: `Painel_Executivo_Financeiro_-_Ragga_Gestão.html` (painel de
referência mencionado no planejamento original). As 3 regras abaixo
foram lidas diretamente do código-fonte desse painel (JavaScript) e são
consideradas as regras **oficiais e já validadas em produção** — não
foram inventadas nem deduzidas por suposição.

### Faturamento
- **Fonte:** arquivo Excel no formato de `FATURAMENTO - 1 SEMESTRE 2026.xlsx`
  (aba "Planilha", ou a primeira aba).
- **Colunas exigidas:** `Filial`, `Data`, `Desc. pagam.`, `Vl. pagamento`.
- **Transformação:** `SUM(Vl. pagamento)` agrupado por `Filial + Data`.
  Nenhuma linha é excluída por cancelamento ou valor negativo.
- **Chave de reimportação:** `Filial + Data` (upsert — substitui o valor
  do dia, não soma de novo).
- **Regra de data:** D-1.

### PDV × Maquininha
- **Fonte oficial:** `PDV X Adquirente - Consolidado.xlsx`, aba `Export`
  especificamente (cai para a 1ª aba só se "Export" não existir).
  `banco x maquina.xlsx` **não é usado**.
- **Colunas exigidas:** `Loja`, `Data`, coluna que começa com "forma de
  pag" (`Forma de Pag.`), coluna que começa com "venda" (`Venda (PDV -
  Cloud)`), coluna que começa com "total maq" (`Total Maq. (Adquirente -
  Sicredi)`), `Diferença`.
- **Transformação:** guarda os 3 números crus por `Filial+Data+Forma`
  (`valorPDV`, `valorMaquininha`, `diferenca`) — a diferença não é
  recalculada, é lida direto da planilha.
- **Chave de reimportação:** `Filial + Data + Forma` (upsert).
- **Regra de data:** D-2, aplicada em tempo de consulta sobre a única
  coluna `Data` existente (não há uma segunda coluna de "data da
  máquina" em nenhum arquivo real).

### Retirada Depósito
- **Fonte oficial:** `Retirada Depósito.xlsx` (a versão de ~56 registros,
  única que tem as colunas `Motivo` E `Motivo/Descrição` separadas).
- **Colunas exigidas:** `Filial`, `Caixa`, `Data`, `Valor`, `Motivo`,
  `Motivo/Descrição`, `Usuário`, `Usuário autorizador`.
- **Transformação/filtro:** o indicador "Retirada Depósito" só soma
  linhas onde `Motivo` (coluna oficial de classificação) é **exatamente
  "DEPOSITO"** (case/acento-insensível). Outras classificações no mesmo
  arquivo (ex. "SUPRIMENTO") existem mas são excluídas deste indicador.
- **Chave de reimportação:** `Filial + Data + Caixa + Motivo +
  Motivo/Descrição + Usuário + Usuário autorizador` (valor
  deliberadamente fora da chave, para que uma correção de valor atualize
  o registro em vez de criar um novo).
- **As abas `RETIRADA DEPOSITO.xlsx` (coud/SUPRIMENTO/SANGRIA/RETIRDA
  PARA SUPRIR/RETIRADA INCORRETA) e `RETIRADA DEPOSITO NOVO.xlsx` NÃO
  alimentam este indicador hoje.**

## Investigação: "CASARIA" → MAPOLI

Buscado em todos os 38 arquivos `.xlsx` de `BASE DE DADOS - POWERBI`
(incluindo subpastas; **não** buscado na pasta pessoal `Downloads`, que
tem centenas de outros arquivos fora do escopo do projeto).

**Onde "CASARIA" aparece como valor de Filial/Loja (não apenas em texto
livre de motivo/descrição):**

| Arquivo | Aba | Linha (exemplo) | Data | Coluna |
|---|---|---|---|---|
| `RETIRADA DEPOSITO NOVO.xlsx` | Planilha1 | 17, 33, 49 | 04/09/2025, 08/09/2025, 12/09/2025 | Loja |
| `indicadores/BRINDES - 2 SEMESTRE 2025.xlsx` | Planilha1 | 205, 285, 357 (e outras) | 03/11/2025, 04/11/2025, 05/11/2025 | Loja — caixa associado: `"CA01 - PDV 01"` |
| `CONTROLE DE CONFERENCIA E QUEBRAS DE CAIXA (5).xlsx` | `QUEBRA 16-08 A 15-09` | 15, 21 | 17/08/2026, 18/08/2026 | LOJA (col. 3, junto de "MONALISA" na coluna de conferente) |
| `indicadores/CANCELAMENTO DE DELIVERY - 2 SEMESTRE 2025.xlsx` | — | — | 2º semestre 2025 | Filial |
| `indicadores/CANCELAMENTO DE SALÃO - 2 SEMESTRE 2025.xlsx` | — | — | 2º semestre 2025 | Filial |
| `indicadores/COMPRA DIRETA - 2 SEMESTRE 2025.xlsx` | — | — | 2º semestre 2025 | Filial |
| `PROJETO_RECEBIVEIS/04_REGRAS/REGRAS_RECEBIVEIS.xlsx` | — | — | — | — |
| `PROJETO_RECEBIVEIS/07_SAIDAS_DINHEIRO/COMPRA DIRETA NOV.xlsx` | — | — | — | Filial |

**Evidência direta de que é a MAPOLI:** o arquivo
`PROJETO_RECEBIVEIS/02_EXTRATOS_BANCARIOS/02_EXTRATOS_BANCARIOS.xlsx`
contém literalmente a string **`"MAPOLI 01 - CASARIA"`** — as duas
palavras juntas na mesma célula, associando explicitamente o nome
"Casaria" à unidade Mapoli.

**Padrão observado:** a maioria das ocorrências de "CASARIA" como valor
de filial está em bases do 2º semestre de 2025 (com caixa associado no
prefixo `"CA01"`, não `"BG"`/`"IS"`), mas também aparece em agosto/2026
na aba `QUEBRA 16-08 A 15-09` do arquivo de Conferência/Quebra de Caixa
— ou seja, **não é só um nome histórico abandonado**; ainda aparecia em
dados recentes (ago/2026). Não sei se isso é uso inconsistente contínuo
ou um caso isolado.

**Confirmado pelo usuário.** Adicionado a
`apps/web/lib/import/normalizarUnidade.ts` (`CASARIA` → `MAPOLI`), com
teste em `apps/web/tests/unit/normalizarUnidade.test.ts`.
