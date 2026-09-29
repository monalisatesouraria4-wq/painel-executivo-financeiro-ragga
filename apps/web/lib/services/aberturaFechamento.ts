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
  /** Soma de `difFechamento` (diferença identificada pelo operador no fechamento) — agregação pura das linhas, sem tolerância inventada. */
  diferencaFinanceira: number;
  linhas: CaixaAberturaFechamentoLinha[];
}
