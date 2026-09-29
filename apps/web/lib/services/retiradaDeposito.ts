import type { CodigoUnidade } from "@painel/shared";

/**
 * Tipos de "Retirada para Depósito" — SEM import de banco, de propósito:
 * este arquivo é importado por `RetiradaDepositoTab.tsx` (client
 * component, chama `buscarRetiradaDepositoPersonalizado` direto na
 * interação do usuário). A consulta real mora em `retiradaDeposito.server.ts`
 * (usada pela Server Component da página) e em
 * `lib/actions/buscarRetiradaDeposito.ts` (Server Action, chamada pelo
 * client component no modo Personalizado) — mesmo padrão já usado em
 * `indicadores.ts`/`indicadores.server.ts` e
 * `atualizacaoBases.ts`/`persistirBase.ts`.
 *
 * Espelha `renderRetirada`/`renderRetiradaPersonalizado` do legado
 * (linhas 2151-2296) — auditoria funcional confirmada por código-fonte:
 *
 * - Filtro de registro: `isRetiradaDeposito` compara o campo "oficial"
 *   (chamado `classificacao` no legado, `motivo` no nosso schema/parser
 *   — mesma coluna de origem "Motivo" da planilha) === "DEPOSITO". Já
 *   implementado em `lib/import/parsers/retiradaDeposito.ts`.
 * - Modo "Dia": sempre D-1 (`lib/rules/datas.ts` → `dataDMenos1`).
 *   Colunas: Filial | Retirada do dia (D-1) | Acumulado do ciclo | Ciclo.
 * - Modo "Personalizado": cada ciclo somado por inteiro numa linha
 *   própria. Colunas: Filial | Ciclo | Retirada no ciclo | Depósito
 *   esperado.
 * - Sem filtro de loja, sem KPI de total, sem linha TOTAL, sem botão de
 *   exportação — confirmado que essa tela não tem nenhum desses
 *   elementos no legado.
 * - "Ciclo"/"Depósito esperado" são rótulos textuais do dia da semana,
 *   derivados de `dataDeDeposito`/`inicioCicloDeposito`
 *   (`lib/rules/deposito.ts`, já validadas e testadas) — sem recriar a
 *   regra aqui.
 *
 * Sem DATABASE_URL: tudo retorna `disponivel: false` — nenhum valor
 * inventado.
 */

export type ModoRetiradaDeposito = "dia" | "personalizado";

export interface RetiradaDepositoDiaLinha {
  unidade: CodigoUnidade;
  retiradaDia: number;
  acumuladoCiclo: number;
  cicloLabel: string;
}

export interface RetiradaDepositoPersonalizadoLinha {
  unidade: CodigoUnidade;
  cicloLabel: string;
  retiradaCiclo: number;
  depositoEsperadoLabel: string;
}

export type BannerRetiradaDia = "sem_dado" | "base_vazia" | "parcial" | null;

export interface RetiradaDepositoDiaData {
  conectado: boolean;
  disponivel: boolean;
  dataReferenciaD1: Date;
  banner: BannerRetiradaDia;
  maxDataDisponivel: Date | null;
  linhas: RetiradaDepositoDiaLinha[];
}

export interface RetiradaDepositoPersonalizadoData {
  conectado: boolean;
  disponivel: boolean;
  linhas: RetiradaDepositoPersonalizadoLinha[];
}

/** Rótulo textual do ciclo — mesma regra/textos já confirmados no legado, aplicados a partir de `dataDeDeposito`. */
export function rotuloDepositoEsperado(diaSemanaDeposito: number): string {
  return diaSemanaDeposito === 5 ? "Depósito na sexta-feira desta semana" : "Depósito na segunda-feira seguinte";
}
