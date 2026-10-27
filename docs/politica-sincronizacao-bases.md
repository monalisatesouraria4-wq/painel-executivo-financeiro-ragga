# Política de sincronização das bases

> Estado: **implementado e testado localmente; nenhuma gravação em produção foi feita com este mecanismo.**
> Cobre as bases aprovadas (sincronização autoritativa) e **recomenda** — sem alterar o comportamento atual — a política das demais.

## 1. Regra

Quando uma planilha oficial é enviada, o banco deve refletir os dados dela **no período e nas lojas que o próprio arquivo comprova**, sem
manter chaves antigas que já não existem na fonte e sem duplicar lançamentos. O histórico fora desse escopo nunca é tocado.

## 2. Bases com sincronização autoritativa (aprovadas)

| Base | Tabela | Chave (além de loja + data) | Observação |
|---|---|---|---|
| Faturamento | `faturamento` | — | chave só loja + dia: um registro "antigo" só pode ser um **dia que deixou de existir** na fonte |
| Brindes | `brindes` | motivo, motivo2 | |
| Cancelamento Salão | `cancelamento_salao` | motivo | os detalhes individuais (`cancelamento_salao_detalhe`) seguem o fluxo oficial atual, idempotente |
| Cancelamento Delivery | `cancelamento_delivery` | motivo | |
| Compra Direta | `compra_direta` | motivo | |
| Retirada Depósito | `retirada_deposito` | caixa, motivo, motivo_descricao, usuario, usuario_autorizador | a chave não inclui o valor: chave repetida na fonte (última linha vence) **bloqueia a exclusão** |

Implementação: `lib/import/sincronizacaoBase.ts` (planejamento puro), `lib/import/bancoSincronizacaoPg.ts` (SQL/transação),
`lib/import/backupCorrecao.ts` (backup), comando `npm run atualizar-bases` (`apps/web/scripts/atualizar-bases.ts`).

### 2.1 Escopo
- **Lojas** = as presentes no arquivo (nunca "todas as oficiais"). **Datas** = menor e maior data do arquivo.
- Loja com dados no banco no intervalo mas **ausente do arquivo** ⇒ a loja é preservada, a cobertura **não está comprovada** e nenhuma exclusão é autorizada.

### 2.2 Simulação (padrão, somente leitura)
Mostra: Σ da fonte × Σ do banco no escopo; novos, iguais, alterados (valor) e **só no banco (removíveis)**; para cada removível, as chaves da fonte
no mesmo loja+dia (**pista de reclassificação, nunca prova**); quantos loja+dias têm o total igual ou diferente do da fonte; riscos; o **hash do plano**.

### 2.3 Riscos e bloqueios
| Código | Efeito |
|---|---|
| `FONTE_VAZIA`, `BLOQUEIO_EXTERNO` (ex.: rejeição com dado real) | bloqueiam tudo |
| `LOJA_AUSENTE_NO_ARQUIVO` | bloqueia exclusão |
| `DUPLICIDADE_NA_FONTE` (Retirada Depósito) | bloqueia exclusão |
| `LIMITE_EXCEDIDO` | bloqueia exclusão |
| `DIAS_SEM_MOVIMENTO` (loja presente, dia sem nenhuma linha na fonte, mas com dados no banco) | exige confirmação explícita (`--confirmar-dias-sem-movimento <base>`) |
| `ALTERACOES_DE_VALOR`, `ULTIMO_DIA_POSSIVELMENTE_PARCIAL` | aviso |

**Limites de exclusão são opcionais e configuráveis — nenhum é imposto por padrão.** Valores sugeridos *para sua decisão* (não aplicados):
`--limite-remocoes`, `--limite-remocao-percentual`, `--limite-remocao-valor` (R$). Sem eles, o que protege é a aprovação por hash + o bloqueio dos riscos acima.

### 2.4 Gravação (`--gravar`)
- Sem exclusões: grava novos/alterados pela mesma transação, com backup das linhas alteradas.
- **Com exclusões**: exige `--aprovar-exclusoes <base>=<hash do plano>` (o hash da simulação) **e** `--backup-dir <pasta>`.
  O hash cobre: arquivo (SHA-256), escopo, novos, alterados, **IDs exatos a excluir**, estado do banco no escopo (IDs + chaves + valores), confirmações e limites.
- `--sem-exclusao <base>`: grava só novos/alterados e **preserva** os registros só-no-banco (útil quando um risco bloqueia a exclusão).
- Ordem: backup completo (sem sobrescrever, relido e conferido) → transação **serializável** com as linhas do escopo travadas (`FOR UPDATE`) →
  plano recalculado **dentro** da transação (hash idêntico, senão reverte) → exclusão por IDs exatos → upsert → validação final linha a linha
  (contagem, valor de cada chave, total) → conferência de que **nada fora do escopo mudou** → commit. Qualquer divergência ⇒ rollback.
- `--plano <arquivo>`: a gravação só prossegue se o plano atual for idêntico ao simulado.

## 3. Brindes (os 760 registros) — investigação somente de leitura (histórico; a rotina atual preserva os só-no-banco, ver seção 9)
Nenhum registro de Brindes foi excluído ou corrigido. A planilha traz Caixa, Cupom e Produto por linha, mas o banco guarda só o total por
loja/dia/motivo/submotivo; sem a planilha antiga não há prova linha a linha de que um registro antigo e um novo sejam o mesmo lançamento.
Em 215 loja+dias o total do dia é igual ao da fonte (consistente com troca de motivo/submotivo); em 264 o total **difere** (conteúdo da fonte mudou).
A migração de uma tabela de detalhe de Brindes (por cupom/caixa/produto) **não foi feita** (esquema preservado, conforme decisão).

## 4. Recomendação para as demais bases (NÃO implementada — comportamento atual mantido)

| Base | Estrutura / finalidade | Recomendação |
|---|---|---|
| Conferência | contagem diária por filial, por aba de **ciclo**; células preenchidas ao longo dos dias | manter **upsert**; chave filial+dia já é sobrescrita. Acrescentar apenas o relatório (simulação/diff/backup). Sincronização autoritativa não recomendada: a aba é preenchida gradualmente e dias futuros ficam em branco |
| Quebra de Caixa | lançamentos manuais por ciclo; chave conferente+operador+cpf+motivo; valor fora da chave | **candidata a snapshot por ciclo** (aba resolvida pela data), pois correções manuais de data/motivo geram chaves órfãs; só após política aprovada e testes. Até lá: upsert + relatório de órfãos |
| Fechamento de Caixa | extração de caixas abertos/fechados/conciliados; mudanças de estado atualizam a mesma chave | manter **upsert** + relatório de órfãos; avaliar snapshot por período quando houver regra de completude do período |
| PDV × Maquininha | consolidado por forma de pagamento; já houve lote com linhas indevidas | manter **upsert** com a validação de colunas atual; candidata a snapshot por período **depois** de política de nomes de forma e bloqueio de lixo |
| Troco | semanal; o arquivo real tem colisões de chave dentro do próprio arquivo (última vence) | **não** usar snapshot enquanto a chave não identificar a linha de forma única; manter upsert |
| Formas de Pagamento | derivada de `VENDAS.xlsx` (mesma fonte do Faturamento) | **implementada (23/10/2026)**: base autoritativa própria (`formasPagamento`, tabela `formas_pagamento`, chave loja+dia+`Desc. pagam.`), alimentada pelo mesmo arquivo. Histórico acima: deve seguir a política do Faturamento e ser sincronizada **na mesma transação e no mesmo escopo**; hoje uma exclusão de Faturamento deixaria formas antigas |
| Cancelamento Salão (detalhe) | estornos individuais, derivado do mesmo arquivo | idem: sincronizar no mesmo escopo do agregado; hoje segue o fluxo idempotente atual |

Para cada uma, antes de mudar o comportamento: documentar a política (este arquivo), cobrir com testes (unitário + PostgreSQL descartável) e obter sua aprovação.

## 5. Tela de importação (interface) — conectada ao mesmo mecanismo
Para as 6 bases acima, o botão **Atualizar base** passa por: leitura e validação do arquivo no navegador (parser oficial; rejeição com dado real bloqueia) →
**prévia somente leitura calculada no servidor** (`previsualizarSincronizacaoBase`) → revisão (escopo, totais, novos/iguais/alterados, riscos, lista dos só-no-banco
com as chaves da fonte no mesmo dia) → **confirmação explícita** (`confirmarSincronizacaoBase`). A tela só exibe o plano; o servidor **recalcula o plano a partir
do lote recebido** e só grava se o hash aprovado for idêntico. Nada na interface contorna os bloqueios:
- loja ausente / duplicidade / limite ⇒ exclusão bloqueada (o botão fica desabilitado; só resta "preservar" = gravar sem excluir);
- dia sem movimento ⇒ exige marcar a confirmação (entra no hash);
- exclusão ⇒ exige digitar `EXCLUIR n`, ter **backup em arquivo** gravado antes (`SINCRONIZACAO_BACKUP_DIR`; fora de produção o padrão é `apps/web/backups-sincronizacao`) e as exclusões **habilitadas explicitamente**:
  **opt-in em TODOS os ambientes** — só `SINCRONIZACAO_EXCLUSOES_HABILITADAS=1` (valor exato) libera; ausente, `0` ou qualquer outro valor = bloqueado. A mesma trava vale na tela, na Server Action, no motor
  (`sincronizarBase`) e no comando (`atualizar-bases` e `--corrigir --confirmar`); sem a variável, gravar sem excluir (novos/alterados/"preservar") continua permitido;
- o upsert antigo (`persistirBaseNoBanco`) **recusa** essas bases; a ação antiga de sincronização só de Compra Direta foi removida.
Sem `DATABASE_URL` a tela mantém o comportamento anterior (atualização só da sessão do navegador). As demais bases seguem o fluxo anterior.
Alterações de VALOR sem exclusão não exigem backup na tela (como no upsert tradicional); se houver diretório de backup, o backup é feito de qualquer forma.

## 6. Retirada Depósito — regra de cobertura (investigação; exclusões NÃO liberadas)
Achados (somente leitura): (a) a tabela `retirada_deposito` guarda **todos os motivos** (DEPÓSITO, SUPRIMENTO, ERRO), mas a fonte/parsers só importam DEPÓSITO;
(b) o arquivo oficial tem linhas de 15 lojas (qualquer motivo) e só 7 lojas com linha de DEPÓSITO. Consequências e regra adotada:
1. **Escopo de negócio:** só linhas do banco com motivo DEPÓSITO podem ser candidatas a exclusão (`filtroBancoSql`). SUPRIMENTO/ERRO existentes no banco estão **fora do escopo da fonte** e nunca são "só no banco".
   Com isso, no banco real os 39 "removíveis" de antes (todos SUPRIMENTO/ERRO) deixam de existir; o plano fica com 5 novos e 19 iguais.
2. **Cobertura de lojas:** continua sendo a das lojas com linha válida no arquivo (conservadora). A alternativa "loja coberta = aparece em qualquer linha do arquivo, mesmo de outro motivo" **não foi ativada**:
   prova que a loja constou do extrato, mas não que o extrato cobre o dia inteiro; fica como proposta para sua decisão. Mesmo ativada, dias sem movimento continuariam exigindo confirmação explícita.
3. Nada é excluído automaticamente.

## 7. Limitações conhecidas
- Não há camada de autenticação nas Server Actions (como nas demais ações do painel): por isso as exclusões pela interface ficam desabilitadas em produção por padrão.
- O backup em arquivo depende do sistema de arquivos do servidor (em ambiente serverless é efêmero): para exclusões em produção, configure um diretório persistente ou use o comando.
- A sincronização do detalhe do Cancelamento Salão ainda não acompanha o escopo do agregado (ver seção 4); as Formas de Pagamento já são uma base autoritativa própria (seção 9).

## 8. Base mestre: como o botão "Atualizar base" deve se comportar (Brindes e Compra Direta)
Regra: o arquivo enviado é a **base histórica completa**; ao confirmar, o banco passa a **espelhar** a planilha no escopo (lojas presentes × período do arquivo), sem duplicar e sem manter o que não existe mais na fonte.
- **Novos** (chave só na planilha) entram. **Existentes com valor diferente** são atualizados (a planilha prevalece). **Só no banco** (chave que não está mais na planilha) saem — **se a exclusão for aprovada**.
- **Mudança de motivo/submotivo** é, para o banco, "chave antiga some + chave nova entra" (a chave é loja+dia+motivo[+submotivo]). Com a exclusão aprovada o total NÃO acumula; sem excluir, o valor aparece em dobro.
  O sistema não presume que o antigo e o novo sejam o mesmo lançamento (coincidência de loja+dia+valor é só pista); ele espelha a fonte declarada oficial.
- **O plano diz se espelha ou não** (`espelhaPlanilhaAposAplicar` / "✔ ESPELHA" ou "✖ NÃO ESPELHA… sobram R$ X"): sem exclusão aprovada o banco NÃO bate com a planilha, e isso aparece em destaque na prévia (tela e comando).
- Loja ausente do arquivo, chave repetida na fonte, limite excedido: a exclusão fica bloqueada (e o plano avisa que não espelha). Dia sem movimento: exige confirmação marcada. Histórico anterior ao período do arquivo é preservado.
- Totais: ao excluir, a transação só confirma se, depois de aplicar, o escopo do banco for linha a linha IGUAL à planilha (chaves, valores e total) e nada fora do escopo tiver mudado.

### 8.1 Backup recuperável (antes de qualquer exclusão)
- O backup é gravado **antes** da transação, sem sobrescrever, e relido/conferido. Contém: as linhas **completas** excluídas, as linhas completas **antes** da alteração de valor e as chaves que a sincronização **insere**.
- **Restauração testada** (PostgreSQL descartável): `npm run atualizar-bases -- --restaurar <backup.json> [--remover-novos]` (simulação por padrão; `--confirmar` grava). Reinsere os excluídos (mesmo id, todos os campos), devolve o valor anterior e, com `--remover-novos`
  (é uma exclusão: exige `SINCRONIZACAO_EXCLUSOES_HABILITADAS=1`), remove o que a sincronização inseriu — o resultado é **idêntico** ao estado anterior (hash da tabela inteira). Se o banco mudou depois da sincronização, a restauração é bloqueada por conflito.
- **Onde guardar**: em pasta **durável** (ex.: `BACKUPS_BASE/sincronizacao` no OneDrive). O disco temporário/serverless não é aceito pelo modo sincronização. Recomendado também: um backup/ponto de restauração do próprio Supabase antes da primeira sincronização espelho.

### 8.2 Como executar a sincronização com segurança (quando você autorizar)
1. Simular (somente leitura): `npm run atualizar-bases -- "<BRINDES.xlsx>" "<COMPRA DIRETA.xlsx>" --detalhar` — confira novos/alterados/só-no-banco, riscos e se "ESPELHA A PLANILHA".
2. Pelo **comando**: `SINCRONIZACAO_EXCLUSOES_HABILITADAS=1` só **naquele comando** (nunca no `.env.local`) com
   `--gravar --aprovar-exclusoes <base>=<hash> --backup-dir "<pasta durável>"`.
3. Pela **tela**: `npm run painel:sincronizacao -- --backup-dir "<pasta durável>"` sobe uma instância (porta 3100) com as exclusões habilitadas **só nela** (o painel normal e o `.env.local` seguem bloqueados); use o botão Atualizar base, revise a prévia, digite `EXCLUIR n` e confirme. Encerre com Ctrl+C.
4. Depois: rode a simulação de novo (deve mostrar 0 novos, 0 alterados, 0 só no banco e "ESPELHA") e confira os totais.
5. Se algo estiver errado: `--restaurar` com o backup indicado no relatório.

## 9. Rotina "atualizar base(s)": como o fluxo automático se relaciona com esta política
O procedimento operacional (identificar → simular → backup → gravar base a base → verificar → relatório) está no `CLAUDE.md` da raiz e **vale como regra
única** para o comando "atualizar bases". Para não haver regras contraditórias:
- **A rotina nunca exclui.** Ela usa `--sem-exclusao` nas bases autoritativas (Faturamento, Formas de Pagamento, Brindes, Cancelamentos, Compra Direta e
  Retirada Depósito): os registros só-no-banco são **preservados** (mesmo quando o plano diz "NÃO ESPELHA"). O espelhamento com exclusões (seção 8) é um
  procedimento **à parte**, só com pedido e autorização específicos do usuário, backup durável e `SINCRONIZACAO_EXCLUSOES_HABILITADAS=1` apenas naquele comando.
- **Alterações de valor** (a fonte oficial prevalece) seguem automaticamente quando o arquivo oficial está identificado, o plano corresponde à fonte e as
  alterações são consistentes; param diante de divergência, risco de duplicidade ou dúvida de identidade. Todas são listadas no relatório (antes → depois).
- **Quebra de Caixa** só interrompe a rotina diante de risco real de duplicidade/conflito de identidade que a chave oficial (com a ocorrência) não resolva.
- **Cobertura parcial** (dia final com menos lojas, base até uma data, Troco semanal) não bloqueia: é informada como "a completar".
- **Backup verificável:** `npm run backup-pre-gravacao` (somente leitura; `apps/web/scripts/backup-pre-gravacao.ts`) copia as 13 tabelas das cargas, linha a linha, com
  `MANIFESTO.json` (SHA-256, linhas × banco, Σ valor) e se recusa a sobrescrever. Complementa o backup por exclusão/alteração da seção 8.1; não o substitui para exclusões.
- Testes: `tests/unit/backupPreGravacao.test.ts` (fonte falsa) e `tests/integration/backupPreGravacao.pg.test.ts` (PostgreSQL local descartável; nunca o Supabase).
