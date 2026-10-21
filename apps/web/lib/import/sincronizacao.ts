import type { BaseId } from "@/lib/services/atualizacaoBases";

/**
 * Relatório "só no banco" + validação de totais do comando "atualizar base". Função PURA e somente leitura:
 * compara as chaves da planilha com as do banco DENTRO DO ESCOPO do arquivo (lojas presentes × intervalo de datas do
 * arquivo) e aponta registros que ficaram no banco sob uma chave antiga (motivo/data corrigidos na origem). Nunca remove
 * nada: o importador oficial só faz upsert; a decisão sobre órfãos é do usuário. Histórico fora do escopo nunca é listado.
 */

/** Campos que compõem a chave (além de unidade e data) nas bases agregadas por soma. */
export const CAMPOS_CHAVE_SINCRONIZAVEIS: Partial<Record<BaseId, readonly string[]>> = {
  faturamento: [],
  brindes: ["motivo", "motivo2"],
  cancelamentoSalao: ["motivo"],
  cancelamentoDelivery: ["motivo"],
  compraDireta: ["motivo"],
};

export const baseSincronizavel = (base: BaseId): boolean => base in CAMPOS_CHAVE_SINCRONIZAVEIS;

export interface LinhaSincronizacao {
  unidade: string;
  /** AAAA-MM-DD */
  data: string;
  /** valores dos campos de chave extras, na ordem de `CAMPOS_CHAVE_SINCRONIZAVEIS[base]` */
  extras: string[];
  /** valor em centavos (evita erro de ponto flutuante) */
  centavos: number;
}

export const emCentavos = (v: number): number => Math.round(v * 100);

const chaveDe = (l: LinhaSincronizacao): string => [l.unidade, l.data, ...l.extras].join("||");

export interface OrfaoBanco extends LinhaSincronizacao {
  /** Chave da planilha na mesma loja e dia (provável reclassificação): a de mesmo valor ou, se for a única do dia, ela. */
  possivelSubstituta?: { extras: string[]; centavos: number };
  /** true = a chave nova tem exatamente o mesmo valor do registro antigo. */
  mesmoValor: boolean;
}

export interface RelatorioSincronizacao {
  escopo: { unidades: string[]; inicio: string; fim: string } | null;
  planilha: { chaves: number; centavos: number };
  bancoNoEscopo: { chaves: number; centavos: number };
  /** Chaves da planilha já existentes no banco (serão atualizadas/idênticas). */
  emAmbos: number;
  /** Chaves da planilha ainda inexistentes no banco (serão inseridas). */
  novasNaPlanilha: number;
  /** Registros do banco, dentro do escopo, cuja chave não está na planilha. */
  soNoBanco: OrfaoBanco[];
  soNoBancoCentavos: number;
  /** Total esperado do banco no escopo após o upsert = planilha + só-no-banco. */
  totalEsperadoAposImportacaoCentavos: number;
  /** Diferença (banco esperado − planilha): é exatamente o total dos órfãos. */
  diferencaCentavos: number;
}

export interface PlanoSincronizacaoCompraDireta {
  relatorio: RelatorioSincronizacao;
  linhasFinais: LinhaSincronizacao[];
  removidos: number;
  inseridos: number;
  atualizados: number;
}

const chaveLinha = (linha: LinhaSincronizacao): string => [linha.unidade, linha.data, ...linha.extras].join("||");

/** Calcula o snapshot autoritativo sem gravar; fora do escopo preserva exatamente o banco existente. */
export function planejarSincronizacaoCompraDireta(
  planilha: LinhaSincronizacao[],
  banco: LinhaSincronizacao[],
  escopo: { unidades: string[]; inicio: string; fim: string }
): PlanoSincronizacaoCompraDireta {
  if (planilha.length === 0) throw new Error("Sincronização bloqueada: fonte vazia.");
  const agregados = new Map<string, LinhaSincronizacao>();
  for (const linha of planilha) {
    if (!escopo.unidades.includes(linha.unidade) || linha.data < escopo.inicio || linha.data > escopo.fim) {
      throw new Error("A planilha contém registros fora do escopo explícito de sincronização.");
    }
    const chave = chaveLinha(linha);
    const existente = agregados.get(chave);
    agregados.set(chave, existente ? { ...existente, centavos: existente.centavos + linha.centavos } : { ...linha });
  }
  const fonte = [...agregados.values()];
  const relatorio = compararPlanilhaComBanco(fonte, banco, escopo);
  const bancoNoEscopo = banco.filter((linha) => escopo.unidades.includes(linha.unidade) && linha.data >= escopo.inicio && linha.data <= escopo.fim);
  const bancoForaDoEscopo = banco.filter((linha) => !escopo.unidades.includes(linha.unidade) || linha.data < escopo.inicio || linha.data > escopo.fim);
  const bancoPorChave = new Map(bancoNoEscopo.map((linha) => [chaveLinha(linha), linha]));
  const linhasFinais = [...bancoForaDoEscopo, ...fonte];
  return {
    relatorio,
    linhasFinais,
    removidos: relatorio.soNoBanco.length,
    inseridos: relatorio.novasNaPlanilha,
    atualizados: relatorio.emAmbos,
  };
}

export function compararPlanilhaComBanco(
  planilha: LinhaSincronizacao[],
  banco: LinhaSincronizacao[],
  escopoExplicito?: { unidades: string[]; inicio: string; fim: string }
): RelatorioSincronizacao {
  if (planilha.length === 0) {
    return { escopo: null, planilha: { chaves: 0, centavos: 0 }, bancoNoEscopo: { chaves: 0, centavos: 0 }, emAmbos: 0, novasNaPlanilha: 0, soNoBanco: [], soNoBancoCentavos: 0, totalEsperadoAposImportacaoCentavos: 0, diferencaCentavos: 0 };
  }
  const unidades = escopoExplicito?.unidades ?? [...new Set(planilha.map((l) => l.unidade))].sort();
  const datas = planilha.map((l) => l.data).sort();
  const inicio = escopoExplicito?.inicio ?? datas[0];
  const fim = escopoExplicito?.fim ?? datas[datas.length - 1];
  if (inicio > fim || planilha.some((l) => !unidades.includes(l.unidade) || l.data < inicio || l.data > fim)) {
    throw new Error("A planilha contém registros fora do escopo explícito de sincronização.");
  }

  const mapaPlanilha = new Map<string, LinhaSincronizacao>();
  for (const l of planilha) {
    const k = chaveDe(l);
    const atual = mapaPlanilha.get(k);
    mapaPlanilha.set(k, atual ? { ...atual, centavos: atual.centavos + l.centavos } : l);
  }
  const noEscopo = banco.filter((l) => unidades.includes(l.unidade) && l.data >= inicio && l.data <= fim);
  const mapaBanco = new Map<string, LinhaSincronizacao>();
  for (const l of noEscopo) mapaBanco.set(chaveDe(l), l);

  const novas = [...mapaPlanilha.entries()].filter(([k]) => !mapaBanco.has(k)).map(([, l]) => l);
  // Chaves da planilha no mesmo dia e loja (novas OU já gravadas) — candidatas a "substituta" de um registro órfão.
  const planilhaPorDia = new Map<string, LinhaSincronizacao[]>();
  for (const n of mapaPlanilha.values()) planilhaPorDia.set(`${n.unidade}||${n.data}`, [...(planilhaPorDia.get(`${n.unidade}||${n.data}`) ?? []), n]);

  const soNoBanco: OrfaoBanco[] = [];
  for (const [k, l] of mapaBanco) {
    if (mapaPlanilha.has(k)) continue;
    const candidatas = planilhaPorDia.get(`${l.unidade}||${l.data}`) ?? [];
    const igual = candidatas.find((c) => c.centavos === l.centavos);
    const sub = igual ?? (candidatas.length === 1 ? candidatas[0] : undefined);
    soNoBanco.push({ ...l, possivelSubstituta: sub ? { extras: sub.extras, centavos: sub.centavos } : undefined, mesmoValor: Boolean(igual) });
  }
  soNoBanco.sort((a, b) => (a.data + a.unidade).localeCompare(b.data + b.unidade));

  const soma = (ls: Iterable<LinhaSincronizacao>) => [...ls].reduce((s, l) => s + l.centavos, 0);
  const totalPlanilha = soma(mapaPlanilha.values());
  const soNoBancoCentavos = soma(soNoBanco);
  return {
    escopo: { unidades, inicio, fim },
    planilha: { chaves: mapaPlanilha.size, centavos: totalPlanilha },
    bancoNoEscopo: { chaves: mapaBanco.size, centavos: soma(mapaBanco.values()) },
    emAmbos: mapaPlanilha.size - novas.length,
    novasNaPlanilha: novas.length,
    soNoBanco,
    soNoBancoCentavos,
    totalEsperadoAposImportacaoCentavos: totalPlanilha + soNoBancoCentavos,
    diferencaCentavos: soNoBancoCentavos,
  };
}

export const formatarReais = (centavos: number): string =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
