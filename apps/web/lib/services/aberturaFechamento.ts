import type { CodigoUnidade } from "@painel/shared";

/**
 * Tipos client-safe de "Abertura e Fechamento" — nenhum import de banco
 * aqui (mesmo motivo documentado em indicadores.ts/retiradaDeposito.ts).
 *
 * Regra de classificação (auditada em fechamentoCaixa.ts/controlesCaixa.ts
 * antes de implementar esta tela — ver docstring de
 * aberturaFechamento.server.ts para o detalhe completo):
 * - "Situação" real na fonte tem 3 valores possíveis: "Aberto", "Fechado",
 *   "Conciliado" (confirmado em docs/regras-negocio.md, Etapa 3/4, e no
 *   dado real do banco).
 * - Cada LINHA da tabela `fechamento_caixa` já representa um caixa que
 *   teve abertura registrada naquele dia (chave unidade+data+caixa+
 *   movimento) — por isso "linhas.length" == "caixas com abertura", sem
 *   precisar de nenhuma tabela de "caixas esperados" que não existe.
 * - "Fechados" = Situação in ("Fechado", "Conciliado") — ambos
 *   representam o caixa já encerrado (Conciliado é o estágio seguinte,
 *   com a conciliação de diferenças já feita).
 * - "Em aberto" = Situação === "Aberto" — o caixa nunca foi fechado.
 */
export interface CaixaAberturaFechamentoLinha {
  unidade: CodigoUnidade;
  caixa: string;
  movimento: string;
  operador: string | null;
  abertura: string | null;
  fechamento: string | null;
  situacao: string;
  fechado: boolean;
  difFechamento: number | null;
  difConciliacao: number | null;
  difTotal: number | null;
}

export interface AberturaFechamentoData {
  conectado: boolean;
  dataSelecionada: Date;
  /** Data mais recente com QUALQUER registro na tabela — usada para sugerir a data inicial, nunca inventada. */
  dataMaisRecenteDisponivel: Date | null;
  disponivel: boolean;
  totalCaixas: number;
  abertos: number;
  fechados: number;
  emAberto: number;
  /** Soma de `difTotal` (campo "DIF. TOTAL" da base de Fechamento) — agregação pura das linhas; linhas sem DIF. TOTAL não entram na soma. */
  diferencaFinanceira: number;
  linhas: CaixaAberturaFechamentoLinha[];
}

/**
 * Filtro de STATUS do painel de Fechamento. Valores EXATOS armazenados em `fechamento_caixa.situacao`:
 * "Aberto", "Fechado", "Conciliado" (nada é reinterpretado; caixas abertos nunca viram zero — só saem do
 * recorte quando outro status é escolhido).
 */
export type FiltroStatusFechamento = "TODOS" | "Conciliado" | "Fechado" | "Aberto";

export function filtrarLinhasPorStatus(linhas: CaixaAberturaFechamentoLinha[], status: FiltroStatusFechamento): CaixaAberturaFechamentoLinha[] {
  return status === "TODOS" ? linhas : linhas.filter((l) => l.situacao === status);
}

/**
 * Resumo dos "big numbers" a partir de um conjunto de linhas — EXATAMENTE as mesmas fórmulas de
 * `aberturaFechamento.server.ts` (abertos = linhas; fechados = Fechado|Conciliado; emAberto = situação "Aberto";
 * diferença financeira = soma de `difTotal`, o campo "DIF. TOTAL" da base), só aplicadas sobre o recorte filtrado.
 */
export function resumirLinhasFechamento(linhas: CaixaAberturaFechamentoLinha[]) {
  return {
    disponivel: linhas.length > 0,
    abertos: linhas.length,
    fechados: linhas.filter((l) => l.fechado).length,
    emAberto: linhas.filter((l) => l.situacao === "Aberto").length,
    diferencaFinanceira: linhas.reduce((soma, l) => soma + (l.difTotal ?? 0), 0),
  };
}
