import { UNIDADES } from "@painel/shared";

/**
 * Aba Troco — conferência SEMANAL do dinheiro físico reservado para troco nas lojas (não é Retirada de Depósito).
 * Módulo PURO e específico do Troco (nenhuma função compartilhada com outras abas foi alterada).
 *
 * REGRAS (negócio):
 *  - diferença = troco conferido pelo gerente − troco informado pelo colaborador (como na base). Negativa = FALTA;
 *    positiva = SOBRA. O valor a encaminhar para a Quebra soma SÓ o valor absoluto das faltas; sobras são mostradas à
 *    parte e NUNCA compensam faltas.
 *  - Caixa NÃO CONFERIDO: conferido = 0 E informado = 0 (0/0). Qualquer outro caixa mostra evidência de conferência.
 *  - Loja CONFERIDA: pelo menos um caixa com evidência de conferência (os caixas 0/0 dela são só observação).
 *    Loja PENDENTE: todos os caixas previstos para ela na semana estão em 0/0.
 *    Loja SEM REGISTRO: nenhuma linha na base para a semana — ausência de registro NÃO é conferência não realizada.
 *  - Prazo: quarta-feira da semana (seg–dom). Pendente até a quarta (inclusive) = pendente no prazo; depois da quarta =
 *    ATRASADA. "Sem registro" nunca vira atrasada. Semana sem nenhuma linha = "semana ainda não carregada".
 *  - Semana real de segunda a domingo; sem D-2.
 * Datas como AAAA-MM-DD ("puras", UTC).
 */

const TOL = 0.005;
const arred = (v: number) => Math.round(v * 100) / 100;

// ───────────── datas ─────────────

const dataUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const somaDiasISO = (iso: string, n: number): string => {
  const d = dataUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Semana real (segunda a domingo) que contém o dia. */
export function semanaRealISO(dia: string): { inicio: string; fim: string } {
  const dow = dataUtc(dia).getUTCDay(); // 0 = domingo
  const inicio = somaDiasISO(dia, dow === 0 ? -6 : 1 - dow);
  return { inicio, fim: somaDiasISO(inicio, 6) };
}
export const semanaAnteriorISO = (inicioSemana: string) => ({ inicio: somaDiasISO(inicioSemana, -7), fim: somaDiasISO(inicioSemana, -1) });
/** Prazo semanal da conferência: a quarta-feira da própria semana. */
export const prazoConferenciaISO = (inicioSemana: string) => somaDiasISO(inicioSemana, 2);

/** Hoje no fuso de Brasília (AAAA-MM-DD). */
export function hojeBrasilISO(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// ───────────── dados da consulta (formato client-safe) ─────────────

export interface TrocoSemanalDados {
  conectado: boolean;
  /** Última data com registro de troco na base (AAAA-MM-DD) ou `null` (base vazia). */
  ultimaData: string | null;
  /** Semana analisada (segunda a domingo); `null` quando não há como determiná-la. */
  semana: { inicio: string; fim: string } | null;
  /** Linhas da semana analisada E da anterior (de todas as lojas; separe por data). */
  linhas: CaixaTrocoSemana[];
}

// ───────────── caixa ─────────────

export interface CaixaTrocoSemana {
  unidade: string;
  caixa: string;
  /** Data do registro da conferência (AAAA-MM-DD). */
  data: string;
  conferido: number;
  informado: number;
  /** conferido − informado (como gravado na base). */
  diferenca: number;
  operador: string | null;
  planoDeAcao: string | null;
}

export type StatusCaixaTroco = "nao-conferido" | "conferido" | "falta" | "sobra";

export const caixaNaoConferido = (c: Pick<CaixaTrocoSemana, "conferido" | "informado">) => Math.abs(c.conferido) < TOL && Math.abs(c.informado) < TOL;

export function statusCaixaTroco(c: Pick<CaixaTrocoSemana, "conferido" | "informado" | "diferenca">): StatusCaixaTroco {
  if (caixaNaoConferido(c)) return "nao-conferido";
  if (c.diferenca < -TOL) return "falta";
  if (c.diferenca > TOL) return "sobra";
  return "conferido";
}

export const ROTULO_STATUS_CAIXA: Record<StatusCaixaTroco, string> = {
  "nao-conferido": "Não conferido (0/0)",
  conferido: "Conferido",
  falta: "Falta",
  sobra: "Sobra",
};

// ───────────── loja na semana ─────────────

export type SituacaoConferencia = "conferida" | "pendente" | "atrasada" | "sem-registro";

export const ROTULO_SITUACAO: Record<SituacaoConferencia, string> = {
  conferida: "Conferida",
  pendente: "Pendente (no prazo)",
  atrasada: "Atrasada",
  "sem-registro": "Sem registro",
};

export interface LojaSemana {
  unidade: string;
  situacao: SituacaoConferencia;
  caixas: CaixaTrocoSemana[];
  total: number;
  /** Caixas 0/0 (não conferidos). */
  naoConferidos: number;
  caixasNaoConferidos: string[];
  comFalta: number;
  /** Σ |diferença| das faltas. */
  valorFalta: number;
  comSobra: number;
  valorSobra: number;
  /** Planos de ação das FALTAS da loja, exatamente como estão na base (sem repetir o mesmo texto). */
  planos: string[];
  /** Datas de registro da conferência encontradas para a loja. */
  datas: string[];
}

export interface ResumoSemanaTroco {
  semana: { inicio: string; fim: string };
  prazo: string;
  hoje: string;
  /** A semana tem alguma linha na base (de qualquer loja)? Se não, nenhum valor deve ser mostrado como resultado. */
  semanaCarregada: boolean;
  /** Passou da quarta-feira da semana. */
  prazoEncerrado: boolean;
  datasRegistro: string[];
  lojas: LojaSemana[];
  universo: number;
  conferidas: number;
  pendentes: number;
  atrasadas: number;
  semRegistro: number;
  /** Caixas 0/0 em lojas CONFERIDAS (observação — não tornam a loja pendente). */
  caixasNaoConferidosEmLojasConferidas: number;
  lojasComFalta: number;
  caixasComFalta: number;
  /** Valor a encaminhar para a Quebra: Σ |diferença| só das faltas. */
  valorFaltas: number;
  caixasComSobra: number;
  valorSobras: number;
}

const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
const porOrdemOficial = (a: string, b: string) => (ordemOficial.get(a) ?? 99) - (ordemOficial.get(b) ?? 99) || a.localeCompare(b, "pt-BR", { numeric: true });

/**
 * Analisa UMA semana. `linhas` = todas as linhas de troco da semana (qualquer loja; fora da semana são ignoradas);
 * `universo` = lojas avaliadas (padrão: as 17 oficiais; com filtro de loja, só ela).
 */
export function analisarSemanaTroco(e: { linhas: CaixaTrocoSemana[]; inicioSemana: string; hoje: string; universo?: readonly string[] }): ResumoSemanaTroco {
  const semana = semanaRealISO(e.inicioSemana);
  const prazo = prazoConferenciaISO(semana.inicio);
  const universo = [...(e.universo ?? (UNIDADES as readonly string[]))];
  const naSemana = e.linhas.filter((l) => l.data >= semana.inicio && l.data <= semana.fim);
  const semanaCarregada = naSemana.length > 0;
  const prazoEncerrado = e.hoje > prazo;

  const lojas: LojaSemana[] = universo
    .map((unidade) => {
      const caixas = naSemana.filter((l) => l.unidade === unidade).sort((a, b) => a.data.localeCompare(b.data) || a.caixa.localeCompare(b.caixa));
      const faltas = caixas.filter((c) => statusCaixaTroco(c) === "falta");
      const sobras = caixas.filter((c) => statusCaixaTroco(c) === "sobra");
      const naoConf = caixas.filter(caixaNaoConferido);
      const situacao: SituacaoConferencia =
        caixas.length === 0 ? "sem-registro" : naoConf.length < caixas.length ? "conferida" : prazoEncerrado ? "atrasada" : "pendente";
      const planos: string[] = [];
      for (const f of faltas) {
        const p = (f.planoDeAcao ?? "").trim();
        if (p && !planos.includes(p)) planos.push(p);
      }
      return {
        unidade,
        situacao,
        caixas,
        total: caixas.length,
        naoConferidos: naoConf.length,
        caixasNaoConferidos: naoConf.map((c) => c.caixa),
        comFalta: faltas.length,
        valorFalta: arred(faltas.reduce((s, c) => s - c.diferenca, 0)),
        comSobra: sobras.length,
        valorSobra: arred(sobras.reduce((s, c) => s + c.diferenca, 0)),
        planos,
        datas: [...new Set(caixas.map((c) => c.data))].sort(),
      };
    })
    .sort((a, b) => porOrdemOficial(a.unidade, b.unidade));

  const conta = (s: SituacaoConferencia) => lojas.filter((l) => l.situacao === s).length;
  const conferidas = lojas.filter((l) => l.situacao === "conferida");
  return {
    semana,
    prazo,
    hoje: e.hoje,
    semanaCarregada,
    prazoEncerrado,
    datasRegistro: [...new Set(naSemana.map((l) => l.data))].sort(),
    lojas,
    universo: lojas.length,
    conferidas: conferidas.length,
    pendentes: conta("pendente"),
    atrasadas: conta("atrasada"),
    semRegistro: conta("sem-registro"),
    caixasNaoConferidosEmLojasConferidas: conferidas.reduce((s, l) => s + l.naoConferidos, 0),
    lojasComFalta: lojas.filter((l) => l.comFalta > 0).length,
    caixasComFalta: lojas.reduce((s, l) => s + l.comFalta, 0),
    valorFaltas: arred(lojas.reduce((s, l) => s + l.valorFalta, 0)),
    caixasComSobra: lojas.reduce((s, l) => s + l.comSobra, 0),
    valorSobras: arred(lojas.reduce((s, l) => s + l.valorSobra, 0)),
  };
}

export interface LinhaRankingFaltaLoja {
  unidade: string;
  caixasComFalta: number;
  valorFalta: number;
  planos: string[];
}

/** Ranking de faltas por loja: só lojas com falta; maior falta financeira primeiro (empate: mais caixas, depois loja). */
export function rankingFaltasSemana(lojas: readonly LojaSemana[]): LinhaRankingFaltaLoja[] {
  return lojas
    .filter((l) => l.comFalta > 0)
    .map((l) => ({ unidade: l.unidade, caixasComFalta: l.comFalta, valorFalta: l.valorFalta, planos: l.planos }))
    .sort((a, b) => b.valorFalta - a.valorFalta || b.caixasComFalta - a.caixasComFalta || porOrdemOficial(a.unidade, b.unidade));
}

// ───────────── comparação semanal ─────────────

export interface LinhaComparacaoLoja {
  unidade: string;
  situacaoAtual: SituacaoConferencia;
  situacaoAnterior: SituacaoConferencia;
  /** Faltas só são números quando a loja foi conferida na semana; senão `null` (não é zero). */
  faltaAtual: number | null;
  faltaAnterior: number | null;
  /** Só existe quando a loja foi conferida NAS DUAS semanas. */
  variacao: number | null;
  comparavel: boolean;
}

export interface CoberturaSemana {
  conferidas: number;
  pendentes: number;
  atrasadas: number;
  semRegistro: number;
  semanaCarregada: boolean;
}

export type LeituraFaltas = "aumentaram" | "diminuiram" | "iguais" | "indisponivel";

export interface ComparacaoSemanalTroco {
  linhas: LinhaComparacaoLoja[];
  coberturaAtual: CoberturaSemana;
  coberturaAnterior: CoberturaSemana;
  faltasAtual: number;
  faltasAnterior: number;
  /** Diferença dos TOTAIS (atual − anterior), qualquer que seja a cobertura. */
  variacaoTotal: number;
  /** Só as lojas conferidas nas duas semanas — a única parte realmente comparável. */
  comparavel: { lojas: number; faltasAtual: number; faltasAnterior: number; variacao: number };
  /** Lojas cuja situação da conferência mudou de uma semana para a outra. */
  lojasComCoberturaDiferente: string[];
  coberturaDiferente: boolean;
  /** Direção das faltas nas lojas comparáveis (neutra; nunca "melhorou/piorou" sozinha). */
  leitura: LeituraFaltas;
  /** Aviso que SEMPRE acompanha a comparação quando a cobertura difere ou falta base. */
  ressalva: string | null;
}

const cobertura = (r: ResumoSemanaTroco): CoberturaSemana => ({ conferidas: r.conferidas, pendentes: r.pendentes, atrasadas: r.atrasadas, semRegistro: r.semRegistro, semanaCarregada: r.semanaCarregada });
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function compararSemanasTroco(atual: ResumoSemanaTroco, anterior: ResumoSemanaTroco): ComparacaoSemanalTroco {
  const porLojaAnt = new Map(anterior.lojas.map((l) => [l.unidade, l]));
  const linhas: LinhaComparacaoLoja[] = atual.lojas.map((a) => {
    const b = porLojaAnt.get(a.unidade)!;
    const faltaAtual = a.situacao === "conferida" ? a.valorFalta : null;
    const faltaAnterior = b?.situacao === "conferida" ? b.valorFalta : null;
    const comparavel = faltaAtual !== null && faltaAnterior !== null;
    return {
      unidade: a.unidade,
      situacaoAtual: a.situacao,
      situacaoAnterior: b?.situacao ?? "sem-registro",
      faltaAtual,
      faltaAnterior,
      variacao: comparavel ? arred(faltaAtual! - faltaAnterior!) : null,
      comparavel,
    };
  });
  const comp = linhas.filter((l) => l.comparavel);
  const compAtual = arred(comp.reduce((s, l) => s + (l.faltaAtual ?? 0), 0));
  const compAnterior = arred(comp.reduce((s, l) => s + (l.faltaAnterior ?? 0), 0));
  const variacao = arred(compAtual - compAnterior);
  const diferentes = linhas.filter((l) => l.situacaoAtual !== l.situacaoAnterior).map((l) => l.unidade);
  const coberturaDiferente = diferentes.length > 0;
  const leitura: LeituraFaltas = comp.length === 0 ? "indisponivel" : Math.abs(variacao) < TOL ? "iguais" : variacao > 0 ? "aumentaram" : "diminuiram";

  let ressalva: string | null = null;
  if (!atual.semanaCarregada) {
    ressalva = "A semana selecionada ainda não foi carregada na base: não há faltas nem conferências a comparar.";
  } else if (!anterior.semanaCarregada) {
    ressalva = "A semana anterior não tem registro na base: não há com o que comparar — nenhum valor foi tratado como zero.";
  } else if (coberturaDiferente || atual.pendentes + atual.atrasadas + atual.semRegistro > 0 || anterior.pendentes + anterior.atrasadas + anterior.semRegistro > 0) {
    const cob = (r: ResumoSemanaTroco) => `${r.conferidas} conferida(s), ${r.pendentes + r.atrasadas} pendente(s)/atrasada(s), ${r.semRegistro} sem registro`;
    ressalva =
      `Cobertura da conferência: semana atual ${cob(atual)}; semana anterior ${cob(anterior)}. ` +
      `Faltas totais: ${brl(atual.valorFaltas)} contra ${brl(anterior.valorFaltas)} (${variacaoTotalTexto(atual.valorFaltas - anterior.valorFaltas)}). ` +
      (diferentes.length > 0 ? `A situação mudou em: ${diferentes.join(", ")}. ` : "") +
      `Lojas pendentes, atrasadas ou sem registro não têm falta apurada: a diferença entre os totais pode refletir isso, e não uma mudança real. ` +
      `Só as lojas conferidas nas duas semanas são comparáveis (${comp.length}).`;
  }
  return {
    linhas,
    coberturaAtual: cobertura(atual),
    coberturaAnterior: cobertura(anterior),
    faltasAtual: atual.valorFaltas,
    faltasAnterior: anterior.valorFaltas,
    variacaoTotal: arred(atual.valorFaltas - anterior.valorFaltas),
    comparavel: { lojas: comp.length, faltasAtual: compAtual, faltasAnterior: compAnterior, variacao },
    lojasComCoberturaDiferente: diferentes,
    coberturaDiferente,
    leitura,
    ressalva,
  };
}

const variacaoTotalTexto = (v: number) => (Math.abs(v) < TOL ? "sem diferença" : `${v > 0 ? "+" : "-"}${brl(Math.abs(arred(v)))}`);

// ───────────── apresentação resumida da seção A (não altera nenhum cálculo) ─────────────

const listaNomes = (nomes: string[]) => (nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`);

/**
 * Card "Lojas não conferidas": valor = lojas COM registro e sem nenhuma conferência válida (pendentes no prazo +
 * atrasadas — todos os caixas em 0/0). Loja parcialmente conferida NÃO entra. Lojas sem registro na base ficam
 * SEPARADAS, no texto auxiliar (nunca viram "atrasadas"). Semana não carregada: sem valor, só o aviso.
 */
export function resumoLojasNaoConferidas(r: ResumoSemanaTroco): { valor: string; auxiliar: string } {
  const nome = (s: SituacaoConferencia) => r.lojas.filter((l) => l.situacao === s).map((l) => l.unidade);
  const pendentes = nome("pendente");
  const atrasadas = nome("atrasada");
  const semRegistro = nome("sem-registro");
  if (!r.semanaCarregada) return { valor: "—", auxiliar: `Semana ainda não carregada na base: ${semRegistro.length} ${semRegistro.length === 1 ? "loja" : "lojas"} sem registro.` };
  const n = pendentes.length + atrasadas.length;
  const partes: string[] = [];
  if (atrasadas.length > 0) partes.push(`${atrasadas.length} ${atrasadas.length === 1 ? "atrasada" : "atrasadas"} — ${listaNomes(atrasadas)}`);
  if (pendentes.length > 0) partes.push(`${pendentes.length} ${pendentes.length === 1 ? "pendente" : "pendentes"} no prazo — ${listaNomes(pendentes)}`);
  if (semRegistro.length > 0) partes.push(`${semRegistro.length} sem registro na base — ${listaNomes(semRegistro)}`);
  return {
    valor: `${n} ${n === 1 ? "loja" : "lojas"}`,
    auxiliar: partes.length > 0 ? partes.join(" · ") : "Todas as lojas com registro foram conferidas",
  };
}

export interface AvisoCoberturaFaltas {
  /** true = todas as lojas do universo conferidas (apuração completa). */
  completa: boolean;
  texto: string;
  /** Esclarecimento sobre o significado do zero (só quando a cobertura é parcial). */
  esclarecimento: string | null;
}

/**
 * Aviso da seção B (Indicadores de faltas): cobertura efetiva da apuração. Calculado só a partir do resumo da semana
 * (mesma classificação da seção A): lojas conferidas × universo; as demais (pendentes, atrasadas ou sem registro) ainda
 * não têm faltas/sobras apuradas. Semana sem dados → `null` (nada que sugira apuração concluída). Não altera nenhum cálculo.
 */
export function avisoCoberturaFaltas(r: ResumoSemanaTroco): AvisoCoberturaFaltas | null {
  if (!r.semanaCarregada || r.universo === 0) return null;
  const pendentes = r.universo - r.conferidas;
  const lojas = (n: number) => `${n} ${n === 1 ? "loja" : "lojas"}`;
  if (pendentes <= 0) return { completa: true, texto: `Apuração completa: faltas e sobras apuradas ${r.universo === 1 ? "na loja" : `em todas as ${r.universo} lojas`}.`, esclarecimento: null };
  const semRegistro = r.semRegistro > 0 ? ` (${r.semRegistro} sem registro na base)` : "";
  return {
    completa: false,
    texto: `Faltas apuradas em ${r.conferidas} de ${r.universo} ${r.universo === 1 ? "loja" : "lojas"}. ${lojas(pendentes)} ainda ${pendentes === 1 ? "está pendente" : "estão pendentes"} de conferência${semRegistro}.`,
    esclarecimento: "Zero faltas (ou sobras) significa nenhuma identificada entre as lojas efetivamente conferidas, não necessariamente em todas as lojas previstas.",
  };
}
