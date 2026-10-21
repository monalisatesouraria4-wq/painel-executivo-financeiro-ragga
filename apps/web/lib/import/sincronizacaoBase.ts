import { createHash } from "node:crypto";

/**
 * Planejamento PURO (sem banco) da sincronização autoritativa de uma base: compara a fonte oficial (planilha) com o banco
 * dentro do ESCOPO que o próprio arquivo comprova (lojas presentes × intervalo de datas do arquivo) e separa:
 * novos, iguais, alterados (valor) e registros que só existem no banco ("removíveis"). Nunca presume que um registro
 * antigo e um novo são o mesmo lançamento: a coincidência de loja + dia + valor é só uma pista exibida, não uma prova.
 *
 * Regras de segurança embutidas (riscos):
 * - loja ausente do arquivo NUNCA autoriza exclusão (cobertura não comprovada → exclusão bloqueada);
 * - dia sem nenhuma linha na fonte para uma loja presente exige confirmação explícita para excluir o que existe no banco;
 * - duplicidade de chave na fonte que não pode ser agregada (última linha vence) bloqueia a exclusão;
 * - limites de exclusão são OPCIONAIS e configuráveis (nenhum limite é imposto por padrão).
 */

import { BASES_SNAPSHOT, CONFIG_SINCRONIZACAO, baseSnapshot, type BaseSnapshot, type ConfigSincronizacao } from "./basesSnapshot";
export { BASES_SNAPSHOT, CONFIG_SINCRONIZACAO, baseSnapshot };
export type { BaseSnapshot, ConfigSincronizacao };

export interface LinhaFonte {
  unidade: string;
  /** AAAA-MM-DD */
  data: string;
  /** valores dos campos de chave, na ordem de `camposChave` */
  chave: string[];
  /** valor em centavos */
  centavos: number;
}
export interface LinhaBanco extends LinhaFonte {
  id: string;
}

export interface LimitesSincronizacao {
  /** nº máximo de registros removidos */
  maxRemocoes?: number;
  /** máximo de remoções em % dos registros do banco no escopo */
  maxRemocaoPercentual?: number;
  /** valor máximo removido, em centavos */
  maxValorRemovidoCentavos?: number;
}

export interface OpcoesPlano {
  limites?: LimitesSincronizacao;
  /** Confirma que dias sem nenhuma linha na fonte (para lojas presentes) devem ter o que existe no banco removido. */
  confirmarDiasSemMovimento?: boolean;
  /** Não executa nenhuma exclusão (somente novos e alterados), mesmo havendo registros só no banco. */
  semExclusao?: boolean;
  /** Bloqueios vindos de fora do planejamento (ex.: rejeições do parser que exigem decisão). */
  bloqueiosExternos?: string[];
  /** SHA-256 do arquivo de origem (entra no hash do plano). */
  arquivoSha256?: string;
}

export type CodigoRisco =
  | "FONTE_VAZIA"
  | "BLOQUEIO_EXTERNO"
  | "LOJA_AUSENTE_NO_ARQUIVO"
  | "DIAS_SEM_MOVIMENTO"
  | "DUPLICIDADE_NA_FONTE"
  | "LIMITE_EXCEDIDO"
  | "ALTERACOES_DE_VALOR"
  | "NAO_ESPELHA_A_PLANILHA"
  | "ULTIMO_DIA_POSSIVELMENTE_PARCIAL";

export interface Risco {
  codigo: CodigoRisco;
  gravidade: "bloqueia-tudo" | "bloqueia-exclusao" | "requer-confirmacao" | "aviso";
  descricao: string;
  itens?: string[];
}

export interface Removivel extends LinhaBanco {
  /** Chaves da fonte na MESMA loja e dia (candidatas a reclassificação — hipótese, nunca prova). */
  candidatasNoMesmoDia: Array<{ chave: string[]; centavos: number; mesmoValor: boolean }>;
}

export interface PlanoSincronizacao {
  base: BaseSnapshot;
  tabela: string;
  escopo: { unidades: string[]; inicio: string; fim: string } | null;
  fonte: { linhas: number; chaves: number; centavos: number };
  bancoNoEscopo: { chaves: number; centavos: number };
  novos: LinhaFonte[];
  iguais: number;
  alterados: Array<{ id: string; antesCentavos: number; depois: LinhaFonte }>;
  /** Registros do banco no escopo cuja chave não existe na fonte. */
  removiveis: Removivel[];
  removiveisCentavos: number;
  /** Quantos desses têm no mesmo loja+dia uma chave da fonte de mesmo valor (pista, não prova). */
  removiveisComCoincidenciaDeValor: number;
  /** Para loja+dias com removíveis: o total do dia no banco é igual ou diferente do total do dia na fonte. */
  totaisDoDia: { iguais: number; diferentes: number; centavosRemoviveisEmDiasIguais: number; centavosRemoviveisEmDiasDiferentes: number };
  riscos: Risco[];
  /** true se cada exclusão pode ser executada (sem risco que bloqueie exclusão). */
  exclusoesPermitidas: boolean;
  /** IDs que serão excluídos se o plano for confirmado (vazio com `semExclusao` ou se a exclusão estiver bloqueada). */
  idsParaRemover: string[];
  podeGravar: boolean;
  /** Total esperado do banco no escopo depois de executar o plano. */
  totalFinalNoEscopoCentavos: number;
  /**
   * true = depois de aplicar o plano o banco no escopo será IGUAL à planilha (nada sobra). false = restam registros que a planilha
   * não tem (exclusões não aprovadas/bloqueadas/`semExclusao`): os totais NÃO baterão com a planilha.
   */
  espelhaPlanilhaAposAplicar: boolean;
  /** Valor que continuará no banco sem existir na planilha (0 quando espelha). */
  sobraAposAplicarCentavos: number;
  hashSnapshotBanco: string;
  hashPlano: string;
}

const SEP = "␟";
export const chaveLinha = (l: { unidade: string; data: string; chave: string[] }): string => [l.unidade, l.data, ...l.chave].join(SEP);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Hash do estado do banco dentro do escopo (inclui IDs): detecta qualquer mudança entre a prévia e a gravação. */
export function hashSnapshotBanco(linhas: LinhaBanco[]): string {
  return sha(linhas.map((l) => [l.id, chaveLinha(l), l.centavos].join("|")).sort().join("\n"));
}

/** Intervalo e lojas que o ARQUIVO comprova (nunca o conjunto de lojas oficiais). */
export function escopoDaFonte(fonte: LinhaFonte[]): { unidades: string[]; inicio: string; fim: string } | null {
  if (fonte.length === 0) return null;
  const datas = fonte.map((l) => l.data).sort();
  return { unidades: [...new Set(fonte.map((l) => l.unidade))].sort(), inicio: datas[0], fim: datas[datas.length - 1] };
}

function agregarFonte(config: ConfigSincronizacao, linhas: LinhaFonte[]): { mapa: Map<string, LinhaFonte>; duplicadas: string[] } {
  const mapa = new Map<string, LinhaFonte>();
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const k = chaveLinha(l);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
    const atual = mapa.get(k);
    if (config.agregacao === "soma") mapa.set(k, atual ? { ...atual, centavos: atual.centavos + l.centavos } : { ...l });
    else mapa.set(k, { ...l });
  }
  const duplicadas = config.agregacao === "ultimo" ? [...contagem.entries()].filter(([, n]) => n > 1).map(([k]) => k.split(SEP).join(" | ")) : [];
  return { mapa, duplicadas };
}

export function planejarSincronizacaoBase(entrada: { base: BaseSnapshot; fonte: LinhaFonte[]; banco: LinhaBanco[]; opcoes?: OpcoesPlano }): PlanoSincronizacao {
  const { base, fonte, opcoes = {} } = entrada;
  const config = CONFIG_SINCRONIZACAO[base];
  const escopo = escopoDaFonte(fonte);
  const riscos: Risco[] = [];
  for (const b of opcoes.bloqueiosExternos ?? []) riscos.push({ codigo: "BLOQUEIO_EXTERNO", gravidade: "bloqueia-tudo", descricao: b });

  if (!escopo) {
    riscos.push({ codigo: "FONTE_VAZIA", gravidade: "bloqueia-tudo", descricao: "A fonte não tem nenhum registro válido: nada será gravado nem excluído." });
    const vazio: PlanoSincronizacao = {
      base, tabela: config.tabela, escopo: null, fonte: { linhas: 0, chaves: 0, centavos: 0 }, bancoNoEscopo: { chaves: 0, centavos: 0 },
      novos: [], iguais: 0, alterados: [], removiveis: [], removiveisCentavos: 0, removiveisComCoincidenciaDeValor: 0,
      totaisDoDia: { iguais: 0, diferentes: 0, centavosRemoviveisEmDiasIguais: 0, centavosRemoviveisEmDiasDiferentes: 0 },
      riscos, exclusoesPermitidas: false, idsParaRemover: [], podeGravar: false, totalFinalNoEscopoCentavos: 0, espelhaPlanilhaAposAplicar: false, sobraAposAplicarCentavos: 0, hashSnapshotBanco: hashSnapshotBanco([]), hashPlano: "",
    };
    vazio.hashPlano = sha(JSON.stringify({ base, vazio: true }));
    return vazio;
  }

  const { mapa: mapaFonte, duplicadas } = agregarFonte(config, fonte);
  const bancoNoIntervalo = entrada.banco.filter((l) => l.data >= escopo.inicio && l.data <= escopo.fim);
  const bancoNoEscopo = bancoNoIntervalo.filter((l) => escopo.unidades.includes(l.unidade));
  const mapaBanco = new Map(bancoNoEscopo.map((l) => [chaveLinha(l), l]));

  const novos: LinhaFonte[] = [];
  const alterados: PlanoSincronizacao["alterados"] = [];
  let iguais = 0;
  for (const [k, l] of mapaFonte) {
    const b = mapaBanco.get(k);
    if (!b) novos.push(l);
    else if (b.centavos !== l.centavos) alterados.push({ id: b.id, antesCentavos: b.centavos, depois: l });
    else iguais++;
  }

  const fontePorDia = new Map<string, LinhaFonte[]>();
  for (const l of mapaFonte.values()) fontePorDia.set(`${l.unidade}${SEP}${l.data}`, [...(fontePorDia.get(`${l.unidade}${SEP}${l.data}`) ?? []), l]);
  const bancoTotalPorDia = new Map<string, number>();
  for (const b of bancoNoEscopo) bancoTotalPorDia.set(`${b.unidade}${SEP}${b.data}`, (bancoTotalPorDia.get(`${b.unidade}${SEP}${b.data}`) ?? 0) + b.centavos);
  const fonteTotalPorDia = new Map([...fontePorDia].map(([k, ls]) => [k, ls.reduce((s, x) => s + x.centavos, 0)]));

  const removiveis: Removivel[] = [];
  for (const [k, b] of mapaBanco) {
    if (mapaFonte.has(k)) continue;
    const candidatas = (fontePorDia.get(`${b.unidade}${SEP}${b.data}`) ?? []).map((c) => ({ chave: c.chave, centavos: c.centavos, mesmoValor: c.centavos === b.centavos }));
    removiveis.push({ ...b, candidatasNoMesmoDia: candidatas });
  }
  removiveis.sort((a, b) => (a.data + a.unidade + a.chave.join()).localeCompare(b.data + b.unidade + b.chave.join()));
  const soma = (ls: Array<{ centavos: number }>) => ls.reduce((s, l) => s + l.centavos, 0);
  const removiveisCentavos = soma(removiveis);

  const totaisDoDia = { iguais: 0, diferentes: 0, centavosRemoviveisEmDiasIguais: 0, centavosRemoviveisEmDiasDiferentes: 0 };
  const diasComRemoviveis = new Map<string, number>();
  for (const r of removiveis) diasComRemoviveis.set(`${r.unidade}${SEP}${r.data}`, (diasComRemoviveis.get(`${r.unidade}${SEP}${r.data}`) ?? 0) + r.centavos);
  for (const [kd, valorRem] of diasComRemoviveis) {
    if ((bancoTotalPorDia.get(kd) ?? 0) === (fonteTotalPorDia.get(kd) ?? 0)) { totaisDoDia.iguais++; totaisDoDia.centavosRemoviveisEmDiasIguais += valorRem; }
    else { totaisDoDia.diferentes++; totaisDoDia.centavosRemoviveisEmDiasDiferentes += valorRem; }
  }

  // ---- riscos ----
  const lojasNoBancoSemFonte = [...new Set(bancoNoIntervalo.filter((l) => !escopo.unidades.includes(l.unidade)).map((l) => l.unidade))].sort();
  if (lojasNoBancoSemFonte.length > 0) {
    riscos.push({
      codigo: "LOJA_AUSENTE_NO_ARQUIVO", gravidade: "bloqueia-exclusao",
      descricao: `Há dados no banco entre ${escopo.inicio} e ${escopo.fim} para loja(s) que não aparecem no arquivo: a cobertura não está comprovada. Essas lojas NÃO serão tocadas e nenhuma exclusão será autorizada.`,
      itens: lojasNoBancoSemFonte,
    });
  }
  const diasSemMovimento = removiveis.filter((r) => !fontePorDia.has(`${r.unidade}${SEP}${r.data}`));
  const diasSemMovimentoUnicos = [...new Set(diasSemMovimento.map((r) => `${r.unidade} ${r.data}`))];
  if (diasSemMovimentoUnicos.length > 0) {
    riscos.push({
      codigo: "DIAS_SEM_MOVIMENTO",
      gravidade: opcoes.confirmarDiasSemMovimento ? "aviso" : "requer-confirmacao",
      descricao: `${diasSemMovimentoUnicos.length} dia(s) de loja(s) presente(s) no arquivo não têm nenhuma linha na fonte, mas têm registros no banco (${diasSemMovimento.length} registro(s), ${(soma(diasSemMovimento) / 100).toFixed(2)}). Excluir só com confirmação explícita de que o dia realmente não teve movimento.`,
      itens: diasSemMovimentoUnicos.slice(0, 50),
    });
  }
  if (duplicadas.length > 0) {
    riscos.push({
      codigo: "DUPLICIDADE_NA_FONTE", gravidade: "bloqueia-exclusao",
      descricao: `A fonte repete ${duplicadas.length} chave(s) com valores que não podem ser somados (a última linha vence na importação): não é possível provar qual é a verdade, então a exclusão fica bloqueada.`,
      itens: duplicadas.slice(0, 50),
    });
  }
  const lim = opcoes.limites;
  if (lim && removiveis.length > 0) {
    const excedidos: string[] = [];
    if (lim.maxRemocoes !== undefined && removiveis.length > lim.maxRemocoes) excedidos.push(`remoções ${removiveis.length} > ${lim.maxRemocoes}`);
    const pct = bancoNoEscopo.length === 0 ? 0 : (removiveis.length / bancoNoEscopo.length) * 100;
    if (lim.maxRemocaoPercentual !== undefined && pct > lim.maxRemocaoPercentual) excedidos.push(`remoções ${pct.toFixed(2)}% > ${lim.maxRemocaoPercentual}%`);
    if (lim.maxValorRemovidoCentavos !== undefined && removiveisCentavos > lim.maxValorRemovidoCentavos) excedidos.push(`valor removido ${(removiveisCentavos / 100).toFixed(2)} > ${(lim.maxValorRemovidoCentavos / 100).toFixed(2)}`);
    if (excedidos.length) riscos.push({ codigo: "LIMITE_EXCEDIDO", gravidade: "bloqueia-exclusao", descricao: "Limite configurado de exclusão excedido; exige sua aprovação para prosseguir.", itens: excedidos });
  }
  if (alterados.length > 0) {
    riscos.push({ codigo: "ALTERACOES_DE_VALOR", gravidade: "aviso", descricao: `${alterados.length} chave(s) existente(s) mudam de valor (a fonte oficial prevalece).` });
  }
  const datasOrdenadas = [...new Set(fonte.map((l) => l.data))].sort();
  if (datasOrdenadas.length >= 2) {
    const ult = datasOrdenadas[datasOrdenadas.length - 1];
    const pen = datasOrdenadas[datasOrdenadas.length - 2];
    const lojasEm = (d: string) => new Set(fonte.filter((l) => l.data === d).map((l) => l.unidade)).size;
    if (lojasEm(ult) < lojasEm(pen)) {
      riscos.push({ codigo: "ULTIMO_DIA_POSSIVELMENTE_PARCIAL", gravidade: "aviso", descricao: `O último dia (${ult}) tem menos lojas (${lojasEm(ult)}) que o anterior (${lojasEm(pen)}): confira se o arquivo foi exportado antes do fim do dia.` });
    }
  }

  const bloqueiaTudo = riscos.some((r) => r.gravidade === "bloqueia-tudo");
  const bloqueiaExclusao = riscos.some((r) => r.gravidade === "bloqueia-exclusao" || r.gravidade === "requer-confirmacao");
  const exclusoesPermitidas = !bloqueiaTudo && !bloqueiaExclusao;
  const idsParaRemover = !opcoes.semExclusao && exclusoesPermitidas ? removiveis.map((r) => r.id).sort() : [];
  const podeGravar = !bloqueiaTudo && (removiveis.length === 0 || exclusoesPermitidas || Boolean(opcoes.semExclusao));
  const fonteCentavos = soma([...mapaFonte.values()]);
  const bancoCentavos = soma(bancoNoEscopo);
  const snapshot = hashSnapshotBanco(bancoNoEscopo);
  const totalFinalNoEscopoCentavos = idsParaRemover.length > 0 || removiveis.length === 0 ? fonteCentavos : fonteCentavos + removiveisCentavos;
  const espelhaPlanilhaAposAplicar = idsParaRemover.length > 0 || removiveis.length === 0;
  const sobraAposAplicarCentavos = espelhaPlanilhaAposAplicar ? 0 : removiveisCentavos;
  if (!espelhaPlanilhaAposAplicar && !bloqueiaTudo) {
    riscos.push({
      codigo: "NAO_ESPELHA_A_PLANILHA",
      gravidade: "aviso",
      descricao: `Depois de aplicar, o banco AINDA terá ${removiveis.length} registro(s) (${(removiveisCentavos / 100).toFixed(2)}) que a planilha não tem: os totais NÃO baterão com a planilha (banco ${(totalFinalNoEscopoCentavos / 100).toFixed(2)} × planilha ${(fonteCentavos / 100).toFixed(2)}). Para espelhar a planilha é preciso aprovar a exclusão desses registros.`,
    });
  }

  const hashPlano = sha(JSON.stringify({
    base, arquivo: opcoes.arquivoSha256 ?? null, escopo,
    novos: novos.map((l) => [chaveLinha(l), l.centavos]).sort(),
    alterados: alterados.map((a) => [a.id, a.antesCentavos, a.depois.centavos]).sort(),
    remover: idsParaRemover, semExclusao: Boolean(opcoes.semExclusao), confirmarDiasSemMovimento: Boolean(opcoes.confirmarDiasSemMovimento),
    limites: lim ?? null, snapshot,
  }));

  return {
    base, tabela: config.tabela, escopo,
    fonte: { linhas: fonte.length, chaves: mapaFonte.size, centavos: fonteCentavos },
    bancoNoEscopo: { chaves: bancoNoEscopo.length, centavos: bancoCentavos },
    novos, iguais, alterados, removiveis, removiveisCentavos,
    removiveisComCoincidenciaDeValor: removiveis.filter((r) => r.candidatasNoMesmoDia.some((c) => c.mesmoValor)).length,
    totaisDoDia, riscos, exclusoesPermitidas, idsParaRemover, podeGravar, totalFinalNoEscopoCentavos, espelhaPlanilhaAposAplicar, sobraAposAplicarCentavos,
    hashSnapshotBanco: snapshot, hashPlano,
  };
}
