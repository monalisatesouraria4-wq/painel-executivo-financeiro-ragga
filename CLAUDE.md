# Instruções permanentes do projeto — Painel Executivo Financeiro Ragga

Next.js 16 + TypeScript + Drizzle + Supabase, no workspace `apps/web`. A Vercel faz o deploy automático da `main`.
Antes de editar código do Next.js, leia `apps/web/AGENTS.md` (esta versão tem mudanças em relação ao que você conhece).

## Regras gerais
- Nunca faça commit, push ou deploy sem autorização explícita da mensagem atual do usuário.
- Nunca imprima `DATABASE_URL`, senhas ou chaves. Não altere regras de negócio, schema, parsers ou importação sem pedido.
- `apps/web/AGENTS.md` e `apps/web/CLAUDE.md` são gerados pelo `next dev` — não entram em commits (use `git add` com caminhos explícitos).
- Após alterações de código: `npm run test`, `npm run typecheck`, `npm run lint` e `npm run build` (em `apps/web`; o CI roda `next typegen` antes do typecheck).
- Mantenha o painel local rodando (`npm run dev` em background na raiz) e informe `http://localhost:3000/...` para conferência.

## Comando "atualizar base" (fluxo permanente)
Quando o usuário enviar planilhas (anexos com caminho `@"…xlsx"`) e digitar `atualizar base`, **use o comando oficial do projeto**.
Não crie scripts descartáveis, não leia as planilhas por conta própria nem grave por outro caminho.

1. **Simulação (não grava nada).** Em `apps/web`, com todos os caminhos entre aspas:
   `npm run atualizar-bases -- "<arquivo1.xlsx>" "<arquivo2.xlsx>" …`
   O comando identifica a base de cada arquivo (colunas obrigatórias oficiais + nome do arquivo), simula com os parsers
   oficiais e mostra por base: válidos, rejeitados, lojas, período, ciclo (Conferência/Quebra), duplicidades e bloqueios.
   `CONTROLE DE CONFERENCIA E QUEBRAS DE CAIXA (n).xlsx` alimenta duas bases (Conferência e Quebra de Caixa).
2. **Pendências.** Saída com `⛔` / exit code 2 = nada foi gravado. Apresente ao usuário **somente** o que exige decisão:
   arquivo recusado/ambíguo, colunas ausentes, dois arquivos para a mesma base, rejeição com dado real (ex.: data inválida,
   `⚠ PRECISA DE DECISÃO`), aba de ciclo não encontrada. Linhas em branco, totais/legendas da planilha, Retirada Depósito
   fora do escopo e rejeições já aceitas (`apps/web/scripts/rejeicoes-aceitas.json`) NÃO são problema. Nunca corrija a
   planilha por conta própria; informe a célula e espere o usuário. Só use `--aceitar <base>` se o usuário decidir aceitar a
   rejeição (e, se ele quiser que a aceitação seja permanente, acrescente a assinatura em `rejeicoes-aceitas.json`).
3. **Gravação.** Sem pendências, `atualizar base` já é a autorização para gravar. Rode:
   `npm run atualizar-bases -- "<mesmos arquivos>" --gravar --plano "<caminho do plano impresso na simulação>"`
   (arquivos grandes, como `VENDAS.xlsx`: `NODE_OPTIONS=--max-old-space-size=8192`). O comando guarda uma referência de
   segurança (contagem + hash) das tabelas, regrava cada base pelo fluxo oficial `processarArquivoBase` (só upsert pela chave
   oficial — nunca apaga histórico), confere `tabela depois = antes + inseridos`, interrompe na primeira divergência e, ao
   final, compara com a referência. O Cancelamento Salão também grava os detalhes individuais dos estornos (idempotente).
4. **Relatório.** Informe por base: arquivo, válidos, **inseridos, atualizados, rejeitados** e erros, contagens antes/depois e
   o comparativo final × referência. Não dê a base por concluída só porque o processo terminou sem erro.
5. **Falha ou divergência:** pare, explique e aguarde. Não tente contornar, não reimporte "para ver se resolve".
6. Datas: a referência de Conferência/Quebra é a data de hoje (Brasília); use `--ref AAAA-MM-DD` se o usuário indicar outra.
7. Ao terminar, mantenha o painel rodando e informe a URL. Não faça commit/push a menos que o usuário peça.

A tela "Importação de Bases" do painel usa a mesma importação oficial; o comando é a versão de linha de comando dela.
