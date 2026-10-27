# Instruções permanentes do projeto — Painel Executivo Financeiro Ragga

Next.js 16 + TypeScript + Drizzle + Supabase, no workspace `apps/web`. A Vercel faz o deploy automático da `main`.
Antes de editar código do Next.js, leia `apps/web/AGENTS.md` (esta versão tem mudanças em relação ao que você conhece).

## Regras gerais
- Nunca faça commit, push ou deploy sem autorização explícita da mensagem atual do usuário.
- Nunca imprima `DATABASE_URL`, senhas ou chaves. Não altere regras de negócio, schema, parsers ou importação sem pedido.
- `apps/web/AGENTS.md` e `apps/web/CLAUDE.md` são gerados pelo `next dev` — não entram em commits (use `git add` com caminhos explícitos).
- Após alterações de código: `npm run test`, `npm run typecheck`, `npm run lint` e `npm run build` (em `apps/web`; o CI roda `next typegen` antes do typecheck).
- Mantenha o painel local rodando (`npm run dev` em background na raiz) e informe `http://localhost:3000/...` para conferência.

## Comando "atualizar base(s)" (fluxo permanente — execução automática quando tudo estiver consistente)
Quando o usuário enviar planilhas (anexos `@"…xlsx"`) e escrever `atualizar base` / `atualizar bases`, execute o fluxo completo abaixo
**sem pedir um segundo comando de autorização**. Só interrompa nas PARADAS da etapa 3 (problema real que exige decisão do usuário).
Use apenas os comandos oficiais (`npm run atualizar-bases`, `npm run backup-pre-gravacao`, em `apps/web`). Não crie scripts descartáveis
para gravar, não leia as planilhas por conta própria, não corrija planilhas, não contorne divergências e não reimporte "para ver se resolve".

1. **Identificar e conferir os arquivos.** Para cada anexo: existe? data de modificação e SHA-256. O comando identifica a base (colunas
   obrigatórias + nome). `VENDAS.xlsx` alimenta **Faturamento e Formas de Pagamento**; `CONTROLE DE CONFERENCIA E QUEBRAS…` alimenta
   **Conferência e Quebra de Caixa**. Compare com o `LOG_CARGA.md` da carga anterior (em `BACKUPS_SINCRONIZACAO\`, ao lado da pasta do projeto):
   mesmo SHA-256 = arquivo já carregado (informe "sem mudança" e siga); data de modificação anterior à da última carga do mesmo arquivo =
   versão suspeita (PARE e pergunte). Arquivo ausente/ilegível, não identificado, ambíguo ou duas planilhas para a mesma base = PARE.
2. **Simulação oficial (não grava).** Com todos os caminhos entre aspas:
   `npm run atualizar-bases -- "<arquivo1>" "<arquivo2>" … --sem-exclusao faturamento,formasPagamento,brindes,cancelamentoSalao,cancelamentoDelivery,compraDireta,retiradaDeposito --detalhar`
   (arquivos grandes: `NODE_OPTIONS=--max-old-space-size=8192`; comandos longos: rode em segundo plano e aguarde). Mostra, por base: válidos,
   rejeitados, lojas, período, ciclo (Conferência/Quebra), novos/iguais/alterados/só-no-banco, riscos e o **hash do plano**.
   **Registros que existem só no banco são SEMPRE preservados** (`--sem-exclusao`); nunca exclua.
3. **Decidir se prossegue.**
   **PARE antes de gravar e pergunte** se houver: arquivo ausente, não identificado ou ambíguo; coluna obrigatória ausente; rejeição com dado
   real (ex.: loja não reconhecida, data inválida — `⚠ PRECISA DE DECISÃO`); aba de ciclo ambígua ou não encontrada; hash/SHA divergente;
   **risco real de duplicidade ou dúvida sobre a identidade dos registros** (ver regras abaixo); chave repetida na fonte com valores que
   não podem ser somados e que mude o resultado; ou qualquer inconsistência entre plano, arquivo e banco.
   **NÃO são pendência (siga e informe no relatório):** linhas em branco, totais/legendas da planilha, Retirada Depósito fora do escopo e
   rejeições já aceitas (`apps/web/scripts/rejeicoes-aceitas.json`); registros só-no-banco (preservados); dias parciais ou cobertura até uma
   data anterior (informe a cobertura — ver abaixo); alterações de valor consistentes (ver abaixo).
   - **Alterações de valor em registros existentes.** Prosseguem quando a planilha oficial está identificada, o plano corresponde à fonte
     (hash da simulação = hash da gravação; Σ após aplicar = fonte + preservados) e as alterações são consistentes (a mesma chave oficial
     tem outro valor: a fonte oficial prevalece). **Sem limite numérico automático**; liste TODAS no relatório (data, loja, motivo, antes → depois,
     Σ líquido). PARE se a alteração vier acompanhada de divergência, risco de duplicidade ou dúvida de identidade (ex.: mudança de
     motivo/chave que o plano trata como "novo + só-no-banco" para o mesmo loja+dia+valor e cuja preservação duplicaria o total).
   - **Quebra de Caixa.** A chave oficial é loja+data+conferente+operador+CPF+motivo+ocorrência; ocorrências repetidas ficam como estão na
     planilha (nunca somar nem descartar). Registro só-no-banco **não** é motivo de parada. PARE somente se houver **risco real de duplicidade ou
     conflito de identidade que a chave oficial não resolva** (ex.: lançamento novo na planilha com mesma loja+data+valor+operador de um
     registro só-no-banco cujo motivo/CPF/conferente mudou: gravar somaria os dois). Nunca exclua para contornar: ofereça as saídas (corrigir
     a planilha, aceitar a duplicidade ou exclusão com autorização específica).
   - **Cobertura parcial e periodicidade.** Prossiga e informe até que data cada base vai. Respeite a periodicidade de cada base (o **Troco é
     semanal**: a planilha só ter a conferência até a data da última semana é normal). Dia final com menos lojas que o anterior ou ausência de
     dados diários **não bloqueiam**; só entram no relatório como "a completar".
4. **Backup verificável antes de qualquer gravação.** `npm run backup-pre-gravacao` (somente leitura; transação consistente) copia as 13 tabelas
   das cargas linha a linha para `BACKUPS_SINCRONIZACAO\AAAA-MM-DD_pre-gravacao[-n]\` com `MANIFESTO.json` (SHA-256, nº de linhas × banco, Σ valor),
   nunca sobrescreve e termina com `BACKUP_OK <pasta>`. Reconferir depois: `npm run backup-pre-gravacao -- --verificar "<pasta>"` (`BACKUP_VERIFICADO`).
   Sem `BACKUP_OK` = PARE (nada é gravado). O backup fica preservado para recuperação.
5. **Gravação, base por base** (ordem do comando, ou a pedida pelo usuário), repetindo a simulação da base logo antes de gravar:
   `npm run atualizar-bases -- "<arquivo>" --somente <base> [--sem-exclusao <base>] --gravar --plano "<plano da simulação>" --backup-dir "<pasta do backup>"`.
   Antes de cada base: SHA-256 do arquivo = o conferido na etapa 1 e hash do plano = o da simulação (se mudar, PARE). Depois de cada base:
   `tabela depois = antes + inseridos`, Σ no escopo = fonte (+ preservados) e nenhum `⚠ DIVERGE`. Para detectar falha use **marcadores exatos**
   (`INTERROMPIDO`, `⛔`, `DIVERGE`, `REVERTIDA`); **nunca** procure a palavra "ERRO" solta (aparece em motivos como "ERRO DE DESPACHO").
   Na primeira falha real: pare, informe quais bases já foram gravadas e quais não, preserve os backups e aguarde o usuário. Não corrija sozinho.
   Bases sem hash de plano (Conferência, Quebra, Fechamento, Troco, PDV × Maquininha) gravam por upsert pela chave oficial (nunca excluem); confira a
   contagem esperada e, na Quebra, os totais por data da simulação.
6. **Verificação após gravar (somente leitura).** Contagens e totais × plano; Faturamento × Formas de Pagamento por dia (diferença 0);
   ausência de duplicidade de chave; registros preservados ainda presentes; histórico anterior intacto (comparar com o `MANIFESTO.json`).
7. **Relatório final e registro.** Por base: arquivo, válidos, inseridos, atualizados, preservados, rejeitados, antes → depois e totais; a lista
   das alterações de valor; os **períodos ainda incompletos** (base só até uma data; último dia parcial; Troco da semana) para a próxima carga.
   Grave o `LOG_CARGA.md` (data, arquivos com SHA-256, hashes dos planos, resultado por base) na pasta do backup.

**Sempre proibido sem pedido ESPECÍFICO do usuário:** excluir registros de qualquer base; habilitar `SINCRONIZACAO_EXCLUSOES_HABILITADAS`
(o `.env.local` mantém `=0`); executar o plano de correção da Compra Direta (`--corrigir`); alterar planilhas oficiais; commit/push/deploy.
Exclusões só pelo procedimento de `docs/politica-sincronizacao-bases.md` §8 (backup durável + `--restaurar` para desfazer). Datas: a referência
de Conferência/Quebra é a data de hoje (Brasília); use `--ref AAAA-MM-DD` se o usuário indicar outra. Ao terminar, mantenha o painel rodando e informe a URL.

A tela "Importação de Bases" do painel usa a mesma importação oficial; o comando é a versão de linha de comando dela.
