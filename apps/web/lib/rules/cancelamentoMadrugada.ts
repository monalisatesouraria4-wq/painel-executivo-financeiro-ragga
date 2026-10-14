/**
 * Regras do alerta "Cancelamentos após 00h30" (Cancelamento Salão). Funções PURAS, sobre datas "puras" (AAAA-MM-DD) e
 * minutos do dia (0–1439) do horário do estorno como gravado na planilha (sem conversão de fuso).
 *
 * Regras definitivas:
 *  - Janela: estorno DEPOIS de 00h30 e ANTES das 06h00 — 00h30 e 06h00 ficam de fora (minutos 31 a 359 ⇒ 00h31 a 05h59);
 *  - Data operacional: o estorno dessa janela pertence ao dia calendário ANTERIOR (a noite que ainda estava aberta).
 *    Estornos fora da janela mantêm a data do calendário (a regra não os reatribui).
 */

/** Minuto-do-dia exclusivo de início da janela (00h30). */
export const MINUTO_INICIO_EXCLUSIVO = 30;
/** Minuto-do-dia exclusivo de fim da janela (06h00). */
export const MINUTO_FIM_EXCLUSIVO = 6 * 60;

export const minutoDoDia = (hora: number, minuto: number) => hora * 60 + minuto;

/** O estorno está na janela "após 00h30 e antes das 06h00" (exclui exatamente 00h30 e 06h00)? */
export function estornoNaJanelaMadrugada(minuto: number): boolean {
  return minuto > MINUTO_INICIO_EXCLUSIVO && minuto < MINUTO_FIM_EXCLUSIVO;
}

const somaDiasISO = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Data operacional (AAAA-MM-DD): dia anterior para estornos de 00h31 a 05h59; senão, a própria data do calendário. */
export function dataOperacionalDoEstorno(dataCalendario: string, minuto: number): string {
  return estornoNaJanelaMadrugada(minuto) ? somaDiasISO(dataCalendario, -1) : dataCalendario;
}

// ───────────── resumo do alerta ─────────────

export interface EstornoMadrugada {
  unidade: string;
  dataOperacional: string;
  /** "AAAA-MM-DD HH:MM:SS" como gravado. */
  estornoEm: string;
  comanda: string;
  produto: string;
  quantidade: number;
  valor: number;
  motivo: string;
  atendente: string;
  autorizador: string;
}

export interface LojaMadrugada {
  unidade: string;
  estornos: number;
  /** Comandas distintas (loja + comanda + data operacional — o número da comanda se repete ao longo dos dias). */
  comandas: number;
  valor: number;
  linhas: EstornoMadrugada[];
}

export interface ResumoMadrugada {
  estornos: number;
  valor: number;
  comandas: number;
  lojas: LojaMadrugada[];
  porMotivo: { motivo: string; estornos: number; valor: number }[];
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** Resumo: cada linha é UM estorno (item). Lojas do maior valor para o menor; linhas em ordem cronológica. */
export function resumirMadrugada(linhas: EstornoMadrugada[]): ResumoMadrugada {
  const porLoja = new Map<string, EstornoMadrugada[]>();
  for (const l of linhas) porLoja.set(l.unidade, [...(porLoja.get(l.unidade) ?? []), l]);
  const lojas: LojaMadrugada[] = [...porLoja.entries()]
    .map(([unidade, ls]) => ({
      unidade,
      estornos: ls.length,
      comandas: new Set(ls.map((l) => `${l.comanda}|${l.dataOperacional}`)).size,
      valor: arred(ls.reduce((s, l) => s + l.valor, 0)),
      linhas: [...ls].sort((a, b) => a.estornoEm.localeCompare(b.estornoEm) || a.comanda.localeCompare(b.comanda)),
    }))
    .sort((a, b) => b.valor - a.valor || b.estornos - a.estornos || a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }));
  const motivos = new Map<string, { estornos: number; valor: number }>();
  for (const l of linhas) {
    const m = motivos.get(l.motivo) ?? { estornos: 0, valor: 0 };
    m.estornos += 1;
    m.valor += l.valor;
    motivos.set(l.motivo, m);
  }
  return {
    estornos: linhas.length,
    valor: arred(linhas.reduce((s, l) => s + l.valor, 0)),
    comandas: new Set(linhas.map((l) => `${l.unidade}|${l.comanda}|${l.dataOperacional}`)).size,
    lojas,
    porMotivo: [...motivos.entries()].map(([motivo, v]) => ({ motivo, estornos: v.estornos, valor: arred(v.valor) })).sort((a, b) => b.valor - a.valor || b.estornos - a.estornos),
  };
}
