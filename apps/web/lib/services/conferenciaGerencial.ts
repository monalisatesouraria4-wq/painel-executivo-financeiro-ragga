import { UNIDADES } from "@painel/shared";

/**
 * Camada gerencial de Conferência (aba Conferência + Fechamento Semanal). Só AGREGA registros loja × dia já lidos da
 * base (`ConferenciaLinha.dias[]` ou linhas da tabela `conferencia`) — nenhuma consulta, nada gravado e nenhuma regra
 * de leitura/importação alterada.
 *
 * Regra por registro loja × dia (leitura da matriz):
 * - número (verde)  = caixas CONFERIDAS naquele dia, somadas INTEGRALMENTE (sem limite ao cadastro);
 * - X               = atraso oficial da planilha: conta a quantidade de caixas CADASTRADAS da loja naquele dia como
 *                     caixas EM ATRASO (qualquer dia em que apareça; nunca recalculado por prazo);
 * - 0               = nenhuma caixa conferida — NÃO é atraso;
 * - diferença entre cadastro e número conferido, sem X, NUNCA gera atraso.
 *
 * Indicadores (rede, loja e dia):
 * - CONFERIDAS = Σ números;  EM ATRASO = Σ cadastradas dos registros com X;
 * - PREVISTAS  = conferidas + em atraso (não a soma dos cadastros diários, que recontaria caixas já conferidas);
 * - % CONFERÊNCIA = conferidas ÷ previstas × 100 (nunca média de percentuais).
 *
 * Exceção documentada (docs/regras-negocio.md): a MAPOLI não tem conferência aos sábados e domingos — esses registros
 * não entram em nenhuma soma. Só dias com registro na base entram.
 */

export interface DiaConferenciaEntrada {
  data: Date;
  qtdCadastrados: number;
  qtdConferidos: number | null;
  emAtraso: boolean;
}

export interface LinhaConferenciaEntrada {
  unidade: string;
  dias: DiaConferenciaEntrada[];
}

export interface ResumoConferenciaGerencial {
  /** conferidas + em atraso. */
  previstas: number;
  conferidas: number;
  /** Σ cadastradas dos registros com X. */
  atrasadas: number;
  /** conferidas ÷ previstas × 100; `null` quando não há previstas. */
  percentual: number | null;
}

export interface LojaConferenciaGerencial extends ResumoConferenciaGerencial {
  unidade: string;
}

export interface ConferenciaGerencial {
  rede: ResumoConferenciaGerencial;
  /** Lojas com previstas > 0: MAIOR quantidade de caixas em atraso primeiro; empate: menor %; depois ordem oficial. */
  lojas: LojaConferenciaGerencial[];
  /** Registros da MAPOLI em sábado/domingo, fora de todas as somas. */
  registrosMapoliFimDeSemana: number;
}

export function ehFimDeSemanaSemConferencia(unidade: string, data: Date): boolean {
  const dia = data.getUTCDay();
  return unidade === "MAPOLI" && (dia === 0 || dia === 6);
}

type Acc = { conferidas: number; atrasadas: number };

const finalizar = (a: Acc): ResumoConferenciaGerencial => {
  const previstas = a.conferidas + a.atrasadas;
  return { previstas, conferidas: a.conferidas, atrasadas: a.atrasadas, percentual: previstas > 0 ? (a.conferidas / previstas) * 100 : null };
};

const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
const posicaoOficial = (unidade: string) => ordemOficial.get(unidade) ?? 99;

export function resumirConferenciaGerencial(linhas: LinhaConferenciaEntrada[]): ConferenciaGerencial {
  let registrosMapoliFimDeSemana = 0;
  const porLoja = new Map<string, Acc>();

  for (const l of linhas) {
    const acc = porLoja.get(l.unidade) ?? { conferidas: 0, atrasadas: 0 };
    for (const d of l.dias) {
      if (ehFimDeSemanaSemConferencia(l.unidade, d.data)) {
        registrosMapoliFimDeSemana += 1;
        continue;
      }
      if (d.emAtraso) acc.atrasadas += d.qtdCadastrados;
      else acc.conferidas += d.qtdConferidos ?? 0;
    }
    porLoja.set(l.unidade, acc);
  }

  const rede: Acc = { conferidas: 0, atrasadas: 0 };
  for (const a of porLoja.values()) {
    rede.conferidas += a.conferidas;
    rede.atrasadas += a.atrasadas;
  }

  const lojas: LojaConferenciaGerencial[] = [...porLoja.entries()]
    .map(([unidade, a]) => ({ unidade, ...finalizar(a) }))
    .filter((l) => l.previstas > 0)
    .sort(
      (a, b) =>
        b.atrasadas - a.atrasadas ||
        (a.percentual ?? Number.POSITIVE_INFINITY) - (b.percentual ?? Number.POSITIVE_INFINITY) ||
        posicaoOficial(a.unidade) - posicaoOficial(b.unidade)
    );

  return { rede: finalizar(rede), lojas, registrosMapoliFimDeSemana };
}

export interface PosicaoDoDia {
  /** Data de referência (maior data com lançamento no recorte, sem a MAPOLI de sábado/domingo); `null` sem registros. */
  data: Date | null;
  resumo: ResumoConferenciaGerencial;
}

/** Posição do último dia com lançamento: tudo calculado SÓ sobre a data de referência (X inclusive). */
export function posicaoDoUltimoDia(linhas: LinhaConferenciaEntrada[]): PosicaoDoDia {
  let max = Number.NEGATIVE_INFINITY;
  for (const l of linhas) {
    for (const d of l.dias) {
      if (!ehFimDeSemanaSemConferencia(l.unidade, d.data)) max = Math.max(max, d.data.getTime());
    }
  }
  if (!Number.isFinite(max)) return { data: null, resumo: resumirConferenciaGerencial([]).rede };
  const recorte = linhas.map((l) => ({ unidade: l.unidade, dias: l.dias.filter((d) => d.data.getTime() === max) }));
  return { data: new Date(max), resumo: resumirConferenciaGerencial(recorte).rede };
}
