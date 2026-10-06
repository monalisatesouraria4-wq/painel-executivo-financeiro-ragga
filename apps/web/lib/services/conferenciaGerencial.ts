import { UNIDADES } from "@painel/shared";
import type { ConferenciaLinha } from "@/lib/services/controlesCaixa";

/**
 * Camada gerencial da aba Conferência (cards de resumo + ranking de lojas). Só AGREGA o que a aba já carrega
 * (`ConferenciaLinha.dias[]` = um registro por loja × dia do ciclo/intervalo, vindo de `buscarConferenciaDoPeriodo` /
 * `buscarConferenciaDoIntervalo`) — nenhuma consulta nova, nada gravado e nenhuma regra de leitura da base alterada.
 *
 * Regra (por registro loja × dia):
 * - PREVISTO   = `qtdCadastrados` (caixas que deveriam estar conferidos naquele dia);
 * - CONFERIDO  = `qtdConferidos` (nulo = em atraso/célula vazia → 0), limitado ao previsto do registro — conferido a
 *                mais que o cadastrado (status "Inconsistente" da regra existente) não "paga" a pendência de outro
 *                dia/loja; o excedente é só contabilizado à parte;
 * - PENDENTE   = previsto − conferido (`calcularPendente`, sempre ≥ 0 por registro);
 * - % CONFERÊNCIA = conferido ÷ previsto × 100.
 * Logo, conferido + pendente = previsto em cada registro, na loja e na rede.
 *
 * Exceção documentada (docs/regras-negocio.md): a MAPOLI não tem conferência aos sábados e domingos — esses
 * registros não são "previstos" (e não entram em nenhuma soma). Só dias com registro na base entram: dias futuros do
 * ciclo, ainda sem lançamento, não são previstos.
 */

export interface ResumoConferenciaGerencial {
  previstos: number;
  conferidos: number;
  pendentes: number;
  /** conferido ÷ previsto × 100; `null` quando não há previsto. */
  percentual: number | null;
}

export interface LojaConferenciaGerencial extends ResumoConferenciaGerencial {
  unidade: string;
}

export interface ConferenciaGerencial {
  rede: ResumoConferenciaGerencial;
  /** Todas as lojas com previsto > 0, da MENOR % de conferência para a maior (empate: mais pendentes primeiro). */
  lojas: LojaConferenciaGerencial[];
  /** Registros com conferido > cadastrado (limitados ao cadastrado) e o total excedente — informativo. */
  registrosComExcedente: number;
  unidadesExcedente: number;
  /** Registros da MAPOLI em sábado/domingo, fora do "previsto". */
  registrosMapoliFimDeSemana: number;
}

export function ehFimDeSemanaSemConferencia(unidade: string, data: Date): boolean {
  const dia = data.getUTCDay();
  return unidade === "MAPOLI" && (dia === 0 || dia === 6);
}

const percentualDe = (conferidos: number, previstos: number) => (previstos > 0 ? (conferidos / previstos) * 100 : null);

export function resumirConferenciaGerencial(linhas: Pick<ConferenciaLinha, "unidade" | "dias">[]): ConferenciaGerencial {
  let registrosComExcedente = 0;
  let unidadesExcedente = 0;
  let registrosMapoliFimDeSemana = 0;
  const porLoja = new Map<string, { previstos: number; conferidos: number }>();

  for (const l of linhas) {
    const acc = porLoja.get(l.unidade) ?? { previstos: 0, conferidos: 0 };
    for (const d of l.dias) {
      if (ehFimDeSemanaSemConferencia(l.unidade, d.data)) {
        registrosMapoliFimDeSemana += 1;
        continue;
      }
      const previsto = d.qtdCadastrados;
      const bruto = d.qtdConferidos ?? 0;
      if (bruto > previsto) {
        registrosComExcedente += 1;
        unidadesExcedente += bruto - previsto;
      }
      acc.previstos += previsto;
      acc.conferidos += Math.min(bruto, previsto);
    }
    porLoja.set(l.unidade, acc);
  }

  const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
  const lojas: LojaConferenciaGerencial[] = [...porLoja.entries()]
    .filter(([, v]) => v.previstos > 0)
    .map(([unidade, v]) => ({
      unidade,
      previstos: v.previstos,
      conferidos: v.conferidos,
      pendentes: v.previstos - v.conferidos,
      percentual: percentualDe(v.conferidos, v.previstos),
    }))
    .sort(
      (a, b) =>
        (a.percentual ?? 101) - (b.percentual ?? 101) ||
        b.pendentes - a.pendentes ||
        (ordemOficial.get(a.unidade) ?? 99) - (ordemOficial.get(b.unidade) ?? 99)
    );

  const previstos = lojas.reduce((s, l) => s + l.previstos, 0);
  const conferidos = lojas.reduce((s, l) => s + l.conferidos, 0);
  return {
    rede: { previstos, conferidos, pendentes: previstos - conferidos, percentual: percentualDe(conferidos, previstos) },
    lojas,
    registrosComExcedente,
    unidadesExcedente,
    registrosMapoliFimDeSemana,
  };
}
