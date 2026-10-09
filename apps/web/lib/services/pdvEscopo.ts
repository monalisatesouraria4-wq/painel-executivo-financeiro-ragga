import { periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";

/**
 * Escopo e período da aba PDV × Maquininha (módulo PURO, client-safe).
 *
 *  - PERÍODO LITERAL: a conferência é semanal; a regra D-2 (pensada para uma conferência diária ainda não adotada) NÃO se
 *    aplica a esta aba. Selecionar 28/09 a 04/10 consulta exatamente 28/09 a 04/10 — nem o início nem o fim são deslocados.
 *    (`dataDMenos2` continua existindo em `lib/rules/datas.ts` para as demais abas; aqui ela não é usada.)
 *  - FORMAS: só as que compõem a extração atual do Power BI (Sicredi). Dinheiro, Pagamento online, Venda a prazo e
 *    outras formas históricas ficam de fora dos indicadores — e NÃO são tratadas como zero: simplesmente não pertencem
 *    a esta extração.
 *  - Fórmulas inalteradas: Diferença = Maquininha − PDV; % de divergência = Diferença ÷ Total PDV.
 */
export const FORMAS_PDV_POWER_BI = ["Crédito", "Débito", "Pix", "Voucher"] as const;

export const TEXTO_COBERTURA_PDV =
  "Cobertura: Crédito, Débito, Pix e Voucher (extração do Power BI / Sicredi). Dinheiro, Pagamento online, Venda a prazo e outras formas históricas não fazem parte desta extração e não entram nos indicadores — não são tratadas como zero.";

/** Período consultado = período selecionado, SEM deslocamento D-2. */
export function janelaConsultaPdv(janela: { inicio: Date; fim: Date }): { inicio: Date; fim: Date } {
  return { inicio: new Date(janela.inicio.getTime()), fim: new Date(janela.fim.getTime()) };
}

/** Período anterior equivalente: mesma quantidade de dias, terminando na véspera do início — também SEM D-2. */
export function periodoAnteriorPdv(janela: { inicio: Date; fim: Date }): { inicio: Date; fim: Date } {
  return periodoAnteriorMesmaDuracao(janela.inicio, janela.fim);
}

/** Conta, nas linhas recebidas, as que têm Maquininha = 0 e PDV > 0 (só conta; nunca altera nem converte valores). */
export function contarSemMaquininha(linhas: { valorPdv: number | string; valorMaquininha: number | string }[]): SemMaquininhaPdv {
  let n = 0;
  let pdv = 0;
  for (const l of linhas) {
    if (Number(l.valorMaquininha) === 0 && Number(l.valorPdv) > 0) {
      n += 1;
      pdv += Number(l.valorPdv);
    }
  }
  return { linhas: n, pdv: Math.round(pdv * 100) / 100 };
}

export interface SemMaquininhaPdv {
  /** Linhas (loja+dia+forma) com Maquininha = R$ 0,00 e PDV > 0 no período. */
  linhas: number;
  /** PDV dessas linhas. */
  pdv: number;
}

/**
 * Nota de qualidade: a importação lê célula de Maquininha em branco como 0 (regra existente, igual à coluna
 * "Diferença" da própria fonte), então o banco não distingue "em branco" de "zero". Linhas com PDV > 0 e Maquininha = 0
 * são as candidatas — aqui só são CONTADAS (nunca alteradas).
 */
export function textoSemMaquininha(s: SemMaquininhaPdv | undefined, formatarMoeda: (v: number) => string): string | null {
  if (!s || s.linhas === 0) return null;
  return `${s.linhas} linha(s) (loja+dia+forma) com Maquininha = R$ 0,00 e PDV de ${formatarMoeda(s.pdv)} no período: na origem a célula pode estar em branco (lida como 0), o que aparece como divergência negativa igual ao PDV dessas linhas.`;
}

/**
 * Aviso para a COMPARAÇÃO SEMANAL: quando o período comparado tem linhas com Maquininha = 0 e PDV > 0, parte da
 * divergência comparada pode ser célula em branco na origem (lida como 0). `null` quando não há nenhuma linha assim.
 */
export function avisoComparacaoSemMaquininha(s: SemMaquininhaPdv | undefined, formatarMoeda: (v: number) => string, periodoTxt: string): string | null {
  if (!s || s.linhas === 0) return null;
  return (
    `Atenção ao comparar: no período comparado (${periodoTxt}) há ${s.linhas} linha(s) (loja+dia+forma) com Maquininha = R$ 0,00 e PDV maior que zero, ` +
    `somando ${formatarMoeda(s.pdv)} de PDV. O zero armazenado não permite distinguir uma célula em branco na origem de um valor realmente igual a zero. ` +
    `Valide a extração original (Power BI / Sicredi) antes de concluir que houve falta de recebimento: esse valor entra na comparação como divergência negativa.`
  );
}

/** Estilo discreto do card de "Principais pontos de atenção" conforme o SINAL da diferença (cor ≠ erro comprovado). */
export function classesPontoDeAtencao(sentido: "falta" | "sobra" | "sem-diferenca"): string {
  if (sentido === "falta") return "border-semaforo-vermelho/20 bg-semaforo-vermelho/5";
  if (sentido === "sobra") return "border-semaforo-amarelo/30 bg-semaforo-amarelo/10";
  return "border-ragga-blue/10 bg-ragga-bg";
}

// ───────────── ordenação do ranking de lojas (só a ORDEM VISUAL; nenhum total ou cálculo muda) ─────────────

export type OrdemRankingPdv = "loja" | "valor" | "percentual";

export const OPCOES_ORDEM_RANKING_PDV: { id: OrdemRankingPdv; rotulo: string }[] = [
  { id: "loja", rotulo: "Loja (A–Z)" },
  { id: "valor", rotulo: "Valor da divergência" },
  { id: "percentual", rotulo: "% de divergência" },
];

interface LojaOrdenavel {
  unidade: string;
  diferenca: number;
  percentual: number | null;
}

const porNomeDaLoja = (a: LojaOrdenavel, b: LojaOrdenavel) => a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true, sensitivity: "base" });
const centavos = (v: number) => Math.round(Math.abs(v) * 100);
const microPercentual = (v: number | null) => (v === null ? -1 : Math.round(Math.abs(v) * 1e6)); // sem PDV (sem %) vai para o fim

/**
 * Ordena as LOJAS do ranking (a linha REDE nunca entra aqui — é o total fixo do rodapé).
 *  - "loja": nome em ordem alfabética (números em ordem natural: BG 02 antes de BG 10);
 *  - "valor": maior |diferença| primeiro;
 *  - "percentual": maior |% de divergência| primeiro (loja sem % — sem PDV — por último);
 * Nas duas últimas o valor ABSOLUTO só define a prioridade — o sinal exibido é o original. Empate: nome da loja (A–Z).
 * Devolve uma cópia; a lista recebida não é alterada.
 */
export function ordenarRankingPdv<T extends LojaOrdenavel>(lojas: readonly T[], ordem: OrdemRankingPdv): T[] {
  const copia = [...lojas];
  if (ordem === "loja") return copia.sort(porNomeDaLoja);
  if (ordem === "valor") return copia.sort((a, b) => centavos(b.diferenca) - centavos(a.diferenca) || porNomeDaLoja(a, b));
  return copia.sort((a, b) => microPercentual(b.percentual) - microPercentual(a.percentual) || porNomeDaLoja(a, b));
}

/** Posição de cada loja no ranking por VALOR da divergência (a mesma, qualquer que seja a ordem exibida). */
export function posicaoPorValorPdv<T extends LojaOrdenavel>(lojas: readonly T[]): Map<string, number> {
  return new Map(ordenarRankingPdv(lojas, "valor").map((l, i) => [l.unidade, i + 1]));
}
