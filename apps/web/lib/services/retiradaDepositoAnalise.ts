import { UNIDADES } from "@painel/shared";
import { dataDeDeposito, inicioCicloDeposito } from "@/lib/rules/deposito";
import { diasDoIntervalo } from "@/lib/services/compraDiretaPainel";
import { rotuloDepositoEsperado } from "@/lib/services/retiradaDeposito";
import { periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";

/**
 * Painel gerencial de "Retirada para Depósito". Módulo PURO (sem banco): só organiza os lançamentos de DEPÓSITO que a
 * consulta devolve e a cobertura real da base. Regras PRESERVADAS (nada novo foi inventado):
 *  - indicador = somente lançamentos com `motivo = 'DEPÓSITO'` (ERRO e SUPRIMENTO ficam fora dos totais — a consulta já os exclui);
 *  - datas exatas dos lançamentos (sem D-1/D-2) e ciclos de depósito de `lib/rules/deposito.ts` (segunda–quinta → depósito
 *    na sexta; sexta–domingo → depósito na segunda), cada ciclo em linha própria — ciclos diferentes nunca se somam;
 *  - período anterior = `periodoAnteriorMesmaDuracao` (mesma duração, imediatamente antes);
 *  - SEM faturamento, percentual sobre faturamento, semáforo ou limites: retirada para depósito é transferência de caixa
 *    para o banco, não despesa.
 *
 * LIMITE DA COBERTURA: a tabela é um registro de EVENTOS (poucas linhas por dia, de poucas lojas); "o dia tem linhas" só
 * prova que a janela foi importada, NÃO que uma loja específica foi coberta. Por isso a comparação por loja só existe
 * para lojas com DEPÓSITO registrado nos DOIS períodos ("comparáveis"); lojas com DEPÓSITO em apenas um período são
 * listadas à parte (inclusive as que só aparecem no anterior), sem variação, e o total registrado dos dois períodos é
 * mostrado separado da variação comparável. Ausência de lançamento nunca é tratada como ausência de depósito.
 *
 * COBERTURA: ausência de registro NUNCA vira zero. Um dia só é "sem registro na base" quando NENHUMA linha da tabela
 * (de qualquer motivo) existe nele dentro do intervalo da base; dia com outras classes de lançamento mas sem DEPÓSITO é
 * "sem DEPÓSITO registrado" (não prova que não houve depósito). A comparação só é válida com os dois períodos dentro do
 * intervalo da base, sem dia sem registro e com DEPÓSITO registrado no período anterior; senão "Sem base de comparação".
 * Usuário e autorizador não fazem parte deste módulo (não são carregados nem exibidos).
 */

const arred = (v: number) => Math.round(v * 100) / 100;
const TOLERANCIA = 0.005;
const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDe = (d: Date) => d.toISOString().slice(0, 10);
/** Único motivo que compõe o indicador (literal com acento, como persistido). ERRO e SUPRIMENTO nunca entram. */
export const MOTIVO_DEPOSITO = "DEPÓSITO";
/** Menos que isso, o histórico não permite presumir cobertura mensal. */
export const DIAS_HISTORICO_MINIMO_MENSAL = 31;

export interface LancamentoDeposito {
  unidade: string;
  /** AAAA-MM-DD (data do lançamento, como está na base). */
  data: string;
  valor: number;
  caixa: string;
  motivo: string;
}

export interface CoberturaDeposito {
  conectado: boolean;
  /** Menor/maior data de QUALQUER lançamento da tabela (todas as classes de motivo). */
  minBase: string | null;
  maxBase: string | null;
  /** Menor/maior data de lançamentos DEPÓSITO. */
  minDeposito: string | null;
  maxDeposito: string | null;
  /** Datas distintas com ao menos uma linha na tabela (qualquer motivo). */
  diasComRegistro: string[];
  /** Lojas com ao menos um DEPÓSITO no histórico da base. */
  lojasComDeposito: string[];
}

export const COBERTURA_VAZIA: CoberturaDeposito = { conectado: false, minBase: null, maxBase: null, minDeposito: null, maxDeposito: null, diasComRegistro: [], lojasComDeposito: [] };

// ───────────── Ciclo de depósito (regra existente) ─────────────

export interface CicloDeposito {
  /** Início do ciclo (segunda ou sexta). */
  inicio: string;
  /** Último dia do ciclo (quinta para ciclo de segunda; domingo para ciclo de sexta). */
  fim: string;
  depositoEsperado: string;
  rotulo: string;
}

/** Ciclo que contém a data — usa `inicioCicloDeposito`/`dataDeDeposito` (regras já validadas), sem recriá-las. */
export function cicloDoDia(dataISO: string): CicloDeposito {
  const inicio = inicioCicloDeposito(paraData(dataISO));
  const fim = new Date(inicio.getTime());
  fim.setUTCDate(inicio.getUTCDate() + (inicio.getUTCDay() === 1 ? 3 : 2));
  const deposito = dataDeDeposito(inicio);
  return { inicio: isoDe(inicio), fim: isoDe(fim), depositoEsperado: isoDe(deposito), rotulo: rotuloDepositoEsperado(deposito.getUTCDay()) };
}

// ───────────── Cobertura ─────────────

export type EstadoDia = "deposito" | "sem-deposito-registrado" | "sem-registro" | "fora-da-base";

export interface DiaDeposito {
  data: string;
  estado: EstadoDia;
  /** Só existe com `estado = "deposito"` (nunca zero para dia sem dado). */
  valor: number | null;
  lancamentos: number;
}

export interface ResumoCobertura {
  minBase: string | null;
  maxBase: string | null;
  historicoDias: number;
  historicoCurto: boolean;
  /** Dias SEM nenhuma linha na tabela entre o primeiro e o último registro da base. */
  lacunasBase: string[];
  /** Subconjunto das lacunas que cai dentro do período selecionado. */
  lacunasNoPeriodo: string[];
  periodoDentroDaBase: boolean;
  lojasComDeposito: string[];
}

export function diasDoPeriodo(inicio: string, fim: string): string[] {
  return diasDoIntervalo(inicio, fim);
}

/** Todos os dias entre o primeiro e o último registro da base em que NÃO há nenhuma linha (qualquer motivo). */
export function lacunasDaBase(c: Pick<CoberturaDeposito, "minBase" | "maxBase" | "diasComRegistro">): string[] {
  if (!c.minBase || !c.maxBase) return [];
  const tem = new Set(c.diasComRegistro);
  return diasDoIntervalo(c.minBase, c.maxBase).filter((d) => !tem.has(d));
}

export interface Comparabilidade {
  valida: boolean;
  /** Por que não há base de comparação (quando `valida` é false). */
  motivo: string | null;
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Comparação confiável = os DOIS períodos dentro do intervalo da base, sem dia sem registro, e com DEPÓSITO registrado
 * no período anterior (um período sem DEPÓSITO não é "comprovadamente sem depósito").
 */
export function comparabilidadeDeposito(e: {
  atual: { inicio: string; fim: string };
  anterior: { inicio: string; fim: string };
  cobertura: Pick<CoberturaDeposito, "minBase" | "maxBase" | "diasComRegistro">;
  lancamentosAnterior: number;
}): Comparabilidade {
  const { minBase, maxBase } = e.cobertura;
  if (!minBase || !maxBase) return { valida: false, motivo: "A base de Retirada para Depósito não tem registros." };
  const dentro = (p: { inicio: string; fim: string }) => p.inicio >= minBase && p.fim <= maxBase;
  if (!dentro(e.atual)) return { valida: false, motivo: `O período selecionado não está inteiro dentro do intervalo da base (${dm(minBase)} a ${dm(maxBase)}).` };
  if (!dentro(e.anterior)) {
    return { valida: false, motivo: `O período anterior (${dm(e.anterior.inicio)} a ${dm(e.anterior.fim)}) está fora do intervalo da base (${dm(minBase)} a ${dm(maxBase)}).` };
  }
  const lacunas = lacunasDaBase(e.cobertura);
  for (const [rotulo, p] of [["selecionado", e.atual], ["anterior", e.anterior]] as const) {
    const dias = lacunas.filter((d) => d >= p.inicio && d <= p.fim);
    if (dias.length > 0) return { valida: false, motivo: `O período ${rotulo} tem ${dias.length} dia(s) sem registro na base (${dias.map(dm).join(", ")}).` };
  }
  if (e.lancamentosAnterior === 0) return { valida: false, motivo: "Não há DEPÓSITO registrado no período anterior (a ausência de registro não prova que não houve depósito)." };
  return { valida: true, motivo: null };
}

// ───────────── Montagem do painel ─────────────

export interface LancamentoDetalhado extends LancamentoDeposito {
  ciclo: CicloDeposito;
}

export interface LinhaCicloLoja {
  unidade: string;
  ciclo: CicloDeposito;
  /** Soma dos lançamentos do ciclo DENTRO do período (cada ciclo em linha própria). */
  valor: number;
  lancamentos: number;
  /** O ciclo começa antes ou termina depois do período selecionado: só os dias dentro do período foram somados. */
  parcialNoPeriodo: boolean;
  /** O ciclo termina depois do último registro da base (ainda não completo na base). */
  incompletoNaBase: boolean;
}

export interface LojaDeposito {
  unidade: string;
  total: number;
  lancamentos: number;
  ciclos: LinhaCicloLoja[];
}

/**
 * Linha do "Total por loja": UNIÃO das lojas com DEPÓSITO registrado no período atual e/ou no anterior (sem duplicar).
 * `null` = SEM DEPÓSITO REGISTRADO naquele período — nunca zero comprovado.
 *  - comparavel: nos dois períodos (valores e variação);
 *  - so-atual / so-anterior: "Não comparável" (um dos lados sem registro);
 *  - sem-comparacao: janela sem base — só o período atual é mostrado.
 */
export type TipoLinhaLoja = "comparavel" | "so-atual" | "so-anterior" | "sem-comparacao";

export interface LinhaTotalLoja {
  unidade: string;
  tipo: TipoLinhaLoja;
  atual: number | null;
  anterior: number | null;
  /** Lançamentos/ciclos do período ATUAL (`null` quando a loja não tem DEPÓSITO no atual). */
  lancamentos: number | null;
  ciclos: number | null;
  diferenca: number | null;
  variacaoPercentual: number | null;
}

/**
 * Valor a exibir de um total registrado: `null` quando NÃO há lançamentos (ausência de registro ≠ valor zero);
 * com lançamentos, o total (inclusive R$ 0,00 de lançamento real com valor zero).
 */
export function valorRegistrado(lancamentos: number, total: number): number | null {
  return lancamentos > 0 ? total : null;
}

export interface PainelDeposito {
  periodo: { inicio: string; fim: string; dias: number };
  anterior: { inicio: string; fim: string };
  resumo: {
    total: number;
    lancamentos: number;
    lojasComRetirada: number;
    /** total ÷ lojas com ao menos 1 lançamento DEPÓSITO no período (0 quando não há). */
    mediaPorLoja: number;
    diasComDeposito: number;
    diasSemRegistro: number;
  };
  lojas: LojaDeposito[];
  /** União das lojas dos dois períodos (ver `LinhaTotalLoja`). */
  linhasLojas: LinhaTotalLoja[];
  ciclos: LinhaCicloLoja[];
  diario: DiaDeposito[];
  lancamentos: LancamentoDetalhado[];
  comparacao: {
    /** Condição de janela (base, intervalo, lacunas, DEPÓSITO no anterior). Não garante cobertura por loja. */
    comparabilidade: Comparabilidade;
    /** TOTAL REGISTRADO do período anterior (todas as lojas com DEPÓSITO lá) — só com a janela válida. NÃO é comparável por si só. */
    anterior: { total: number; lojasComRetirada: number; lancamentos: number } | null;
    /** Diferença entre os totais registrados (atual − anterior); factual, sem leitura de melhora/piora. */
    variacaoReais: number | null;
    variacaoPercentual: number | null;
    /** Lojas com DEPÓSITO registrado nos DOIS períodos. */
    lojasComparaveis: LojaComparavel[];
    /** DEPÓSITO registrado só no período atual (sem variação). */
    soNoAtual: { unidade: string; atual: number }[];
    /** DEPÓSITO registrado só no período anterior (sem variação; não é "queda para zero"). */
    soNoAnterior: { unidade: string; anterior: number }[];
    /** Variação apenas das lojas comparáveis; `null` sem janela válida ou sem nenhuma loja comparável. */
    destaque: { quantidadeLojas: number; atual: number; anterior: number; diferenca: number; variacaoPercentual: number | null } | null;
    /** Por que não há destaque comparável. */
    motivoSemDestaque: string | null;
  };
  cobertura: ResumoCobertura;
}

export interface LojaComparavel {
  unidade: string;
  atual: number;
  anterior: number;
  diferenca: number;
  variacaoPercentual: number | null;
}

function somaPorLoja(ls: LancamentoDeposito[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of ls) m.set(l.unidade, (m.get(l.unidade) ?? 0) + l.valor);
  return m;
}

export function montarPainelDeposito(e: {
  inicio: string;
  fim: string;
  /** Lançamentos DEPÓSITO que cobrem o período anterior E o selecionado (a consulta já filtra o motivo). */
  lancamentos: LancamentoDeposito[];
  cobertura: CoberturaDeposito;
  unidade?: string;
}): PainelDeposito {
  const ant = periodoAnteriorMesmaDuracao(paraData(e.inicio), paraData(e.fim));
  const anterior = { inicio: isoDe(ant.inicio), fim: isoDe(ant.fim) };
  // Defesa: mesmo que a consulta devolvesse outras classes (ERRO, SUPRIMENTO...), só DEPÓSITO compõe o indicador.
  const filtroLoja = (l: LancamentoDeposito) => l.motivo === MOTIVO_DEPOSITO && (!e.unidade || l.unidade === e.unidade);
  const noPeriodo = (l: LancamentoDeposito, p: { inicio: string; fim: string }) => l.data >= p.inicio && l.data <= p.fim;
  const atualLs = e.lancamentos.filter((l) => filtroLoja(l) && noPeriodo(l, { inicio: e.inicio, fim: e.fim }));
  const anteriorLs = e.lancamentos.filter((l) => filtroLoja(l) && noPeriodo(l, anterior));
  const { minBase, maxBase } = e.cobertura;
  const ordemOficial = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));

  // ── ciclos por loja (cada ciclo em linha própria)
  const mapaCiclo = new Map<string, LinhaCicloLoja>();
  for (const l of atualLs) {
    const ciclo = cicloDoDia(l.data);
    const chave = `${l.unidade}|${ciclo.inicio}`;
    const atual = mapaCiclo.get(chave);
    if (atual) {
      atual.valor += l.valor;
      atual.lancamentos += 1;
    } else {
      mapaCiclo.set(chave, {
        unidade: l.unidade,
        ciclo,
        valor: l.valor,
        lancamentos: 1,
        parcialNoPeriodo: ciclo.inicio < e.inicio || ciclo.fim > e.fim,
        incompletoNaBase: maxBase !== null && ciclo.fim > maxBase,
      });
    }
  }
  const ciclos = [...mapaCiclo.values()].map((c) => ({ ...c, valor: arred(c.valor) }));

  const porLoja = new Map<string, LinhaCicloLoja[]>();
  for (const c of ciclos) porLoja.set(c.unidade, [...(porLoja.get(c.unidade) ?? []), c]);
  const lojas: LojaDeposito[] = [...porLoja.entries()]
    .map(([unidade, cs]) => ({
      unidade,
      total: arred(cs.reduce((s, c) => s + c.valor, 0)),
      lancamentos: cs.reduce((s, c) => s + c.lancamentos, 0),
      ciclos: cs.sort((a, b) => a.ciclo.inicio.localeCompare(b.ciclo.inicio)),
    }))
    .sort((a, b) => b.total - a.total || (ordemOficial.get(a.unidade) ?? 99) - (ordemOficial.get(b.unidade) ?? 99));
  const ciclosOrdenados = lojas.flatMap((l) => l.ciclos);

  // ── dias
  const dias = diasDoIntervalo(e.inicio, e.fim);
  const comRegistro = new Set(e.cobertura.diasComRegistro);
  const porDia = new Map<string, { valor: number; n: number }>();
  for (const l of atualLs) {
    const a = porDia.get(l.data) ?? { valor: 0, n: 0 };
    a.valor += l.valor;
    a.n += 1;
    porDia.set(l.data, a);
  }
  const diario: DiaDeposito[] = dias.map((data) => {
    const dep = porDia.get(data);
    if (dep) return { data, estado: "deposito", valor: arred(dep.valor), lancamentos: dep.n };
    if (!minBase || !maxBase || data < minBase || data > maxBase) return { data, estado: "fora-da-base", valor: null, lancamentos: 0 };
    return { data, estado: comRegistro.has(data) ? "sem-deposito-registrado" : "sem-registro", valor: null, lancamentos: 0 };
  });

  const total = arred(atualLs.reduce((s, l) => s + l.valor, 0));
  const lojasComRetirada = lojas.filter((l) => l.total > TOLERANCIA).length;

  // ── comparação
  const comparabilidade = comparabilidadeDeposito({ atual: { inicio: e.inicio, fim: e.fim }, anterior, cobertura: e.cobertura, lancamentosAnterior: anteriorLs.length });
  let comparacao: PainelDeposito["comparacao"] = {
    comparabilidade,
    anterior: null,
    variacaoReais: null,
    variacaoPercentual: null,
    lojasComparaveis: [],
    soNoAtual: [],
    soNoAnterior: [],
    destaque: null,
    motivoSemDestaque: comparabilidade.motivo,
  };
  if (comparabilidade.valida) {
    const totalAnt = arred(anteriorLs.reduce((s, l) => s + l.valor, 0));
    const somaAtual = somaPorLoja(atualLs);
    const somaAnterior = somaPorLoja(anteriorLs);
    // "Tem DEPÓSITO registrado" = ao menos um lançamento (não depende do valor somado).
    const comAtual = new Set(atualLs.map((l) => l.unidade));
    const comAnterior = new Set(anteriorLs.map((l) => l.unidade));
    const ordem = (a: string, b: string) => (ordemOficial.get(a) ?? 99) - (ordemOficial.get(b) ?? 99);
    const lojasComparaveis: LojaComparavel[] = [...comAtual]
      .filter((u) => comAnterior.has(u))
      .map((unidade) => {
        const a = arred(somaAtual.get(unidade) ?? 0);
        const b = arred(somaAnterior.get(unidade) ?? 0);
        return { unidade, atual: a, anterior: b, diferenca: arred(a - b), variacaoPercentual: b > TOLERANCIA ? ((a - b) / b) * 100 : null };
      })
      .sort((x, y) => y.atual - x.atual || ordem(x.unidade, y.unidade));
    const soNoAtual = [...comAtual]
      .filter((u) => !comAnterior.has(u))
      .map((unidade) => ({ unidade, atual: arred(somaAtual.get(unidade) ?? 0) }))
      .sort((x, y) => y.atual - x.atual || ordem(x.unidade, y.unidade));
    const soNoAnterior = [...comAnterior]
      .filter((u) => !comAtual.has(u))
      .map((unidade) => ({ unidade, anterior: arred(somaAnterior.get(unidade) ?? 0) }))
      .sort((x, y) => y.anterior - x.anterior || ordem(x.unidade, y.unidade));
    const atualComp = arred(lojasComparaveis.reduce((s, x) => s + x.atual, 0));
    const anteriorComp = arred(lojasComparaveis.reduce((s, x) => s + x.anterior, 0));
    comparacao = {
      comparabilidade,
      anterior: { total: totalAnt, lojasComRetirada: comAnterior.size, lancamentos: anteriorLs.length },
      variacaoReais: arred(total - totalAnt),
      variacaoPercentual: totalAnt > TOLERANCIA ? ((total - totalAnt) / totalAnt) * 100 : null,
      lojasComparaveis,
      soNoAtual,
      soNoAnterior,
      destaque:
        lojasComparaveis.length > 0
          ? {
              quantidadeLojas: lojasComparaveis.length,
              atual: atualComp,
              anterior: anteriorComp,
              diferenca: arred(atualComp - anteriorComp),
              variacaoPercentual: anteriorComp > TOLERANCIA ? ((atualComp - anteriorComp) / anteriorComp) * 100 : null,
            }
          : null,
      motivoSemDestaque: lojasComparaveis.length > 0 ? null : "Nenhuma loja tem DEPÓSITO registrado nos dois períodos.",
    };
  }

  // ── união de lojas para o "Total por loja"
  const comparavelPorLoja = new Map(comparacao.lojasComparaveis.map((x) => [x.unidade, x]));
  const linhasLojas: LinhaTotalLoja[] = lojas.map((l) => {
    const c = comparavelPorLoja.get(l.unidade);
    const base = { unidade: l.unidade, atual: l.total, lancamentos: l.lancamentos, ciclos: l.ciclos.length };
    if (!comparabilidade.valida) return { ...base, tipo: "sem-comparacao" as const, anterior: null, diferenca: null, variacaoPercentual: null };
    if (c) return { ...base, tipo: "comparavel" as const, anterior: c.anterior, diferenca: c.diferenca, variacaoPercentual: c.variacaoPercentual };
    return { ...base, tipo: "so-atual" as const, anterior: null, diferenca: null, variacaoPercentual: null };
  });
  const jaListadas = new Set(linhasLojas.map((l) => l.unidade));
  for (const l of comparacao.soNoAnterior) {
    if (jaListadas.has(l.unidade)) continue; // nunca duplica loja
    jaListadas.add(l.unidade);
    linhasLojas.push({ unidade: l.unidade, tipo: "so-anterior", atual: null, anterior: l.anterior, lancamentos: null, ciclos: null, diferenca: null, variacaoPercentual: null });
  }

  // ── cobertura
  const lacunasBase = lacunasDaBase(e.cobertura);
  const historicoDias = minBase && maxBase ? diasDoIntervalo(minBase, maxBase).length : 0;
  const cobertura: ResumoCobertura = {
    minBase,
    maxBase,
    historicoDias,
    historicoCurto: historicoDias < DIAS_HISTORICO_MINIMO_MENSAL,
    lacunasBase,
    lacunasNoPeriodo: lacunasBase.filter((d) => d >= e.inicio && d <= e.fim),
    periodoDentroDaBase: !!minBase && !!maxBase && e.inicio >= minBase && e.fim <= maxBase,
    lojasComDeposito: e.cobertura.lojasComDeposito,
  };

  return {
    periodo: { inicio: e.inicio, fim: e.fim, dias: dias.length },
    anterior,
    resumo: {
      total,
      lancamentos: atualLs.length,
      lojasComRetirada,
      mediaPorLoja: lojasComRetirada > 0 ? arred(total / lojasComRetirada) : 0,
      diasComDeposito: diario.filter((d) => d.estado === "deposito").length,
      diasSemRegistro: diario.filter((d) => d.estado === "sem-registro").length,
    },
    lojas,
    linhasLojas,
    ciclos: ciclosOrdenados,
    diario,
    lancamentos: atualLs.map((l) => ({ ...l, ciclo: cicloDoDia(l.data) })),
    comparacao,
    cobertura,
  };
}

/** Intervalo inicial da aba: do primeiro ao último dia disponível na base (`null` sem base). */
export function intervaloInicialDeposito(c: Pick<CoberturaDeposito, "minBase" | "maxBase">): { inicio: string; fim: string } | null {
  return c.minBase && c.maxBase ? { inicio: c.minBase, fim: c.maxBase } : null;
}
