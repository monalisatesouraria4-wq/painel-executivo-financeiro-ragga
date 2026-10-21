/**
 * Correção CONTROLADA de registros de Compra Direta que ficaram no banco sob uma chave antiga (motivo reclassificado na
 * origem). Só remove registros identificados por ID em um plano revisado; nunca por filtro, nunca em lote amplo. Toda a
 * lógica de decisão é independente do banco (recebe um `BancoCorrecao`), para poder ser testada sem conexão.
 *
 * Garantias: simulação por padrão (só leitura); gravação somente com `confirmar`; pré-condições validadas antes e DE NOVO
 * dentro da transação; exclusão numa única transação, revertida se o número de linhas afetadas não for exatamente o
 * esperado; backup completo dos registros antes de gravar; contagem e hash de referência antes e depois.
 */

export const MAX_REGISTROS_POR_PLANO = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegistroPlano {
  id: string;
  unidade: string;
  /** AAAA-MM-DD */
  data: string;
  motivo: string;
  /** valor exato, com duas casas (ex.: "27.96") */
  valor: string;
  /** chave nova, já presente no banco, que representa o mesmo lançamento */
  substituta: { motivo: string; valor: string };
}

export interface PlanoCorrecao {
  base: "compraDireta";
  descricao?: string;
  remover: RegistroPlano[];
}

/** Linha do banco com todos os campos disponíveis (`completo` = linha inteira como JSON). */
export interface RegistroBanco {
  id: string;
  unidade: string;
  data: string;
  motivo: string;
  valor: string;
  completo: Record<string, unknown>;
}

export interface LinhaDia {
  motivo: string;
  valor: string;
}

export interface SnapshotTabela {
  n: number;
  hash: string;
}

export interface SnapshotCorrecao {
  /** contagem + hash das tabelas que NÃO podem mudar (e da própria compra_direta) */
  tabelas: Record<string, SnapshotTabela>;
  /** compra_direta excluindo os IDs do plano — deve permanecer idêntica (inclui os outros 49 só-no-banco) */
  compraDiretaSemAlvos: SnapshotTabela;
}

export interface TransacaoCorrecao {
  buscarPorIds(ids: string[]): Promise<RegistroBanco[]>;
  buscarDoDia(unidade: string, data: string): Promise<LinhaDia[]>;
  /** retorna o nº de linhas efetivamente removidas */
  deletarPorIds(ids: string[]): Promise<number>;
  contarCompraDireta(): Promise<number>;
  /** contagem + hash de compra_direta EXCLUINDO os IDs alvo, lidos dentro da transação (após o delete) */
  snapshotSemAlvos(ids: string[]): Promise<SnapshotTabela>;
}

export interface BancoCorrecao {
  buscarPorIds(ids: string[]): Promise<RegistroBanco[]>;
  buscarDoDia(unidade: string, data: string): Promise<LinhaDia[]>;
  snapshot(idsAlvo: string[]): Promise<SnapshotCorrecao>;
  /** executa `fn` em UMA transação; se `fn` lançar erro, tudo é revertido */
  transacao<T>(fn: (tx: TransacaoCorrecao) => Promise<T>): Promise<T>;
}

export interface OpcoesCorrecao {
  confirmar: boolean;
  /** grava o backup (todos os campos) ANTES de qualquer alteração; deve lançar erro se falhar */
  gravarBackup?: (registros: RegistroBanco[]) => Promise<string>;
}

export type ResultadoCorrecao =
  | { status: "plano-invalido"; erros: string[] }
  | { status: "pre-condicao-falhou"; erros: string[] }
  | { status: "simulacao"; registros: RegistroBanco[]; antes: SnapshotCorrecao; removeriaCentavos: number; mensagem: string }
  | { status: "revertido"; erro: string; antes: SnapshotCorrecao }
  | { status: "gravado"; removidos: number; backup: string; antes: SnapshotCorrecao; depois: SnapshotCorrecao; centavosRemovidos: number }
  | { status: "falha-pos-validacao"; erros: string[]; backup: string; antes: SnapshotCorrecao; depois: SnapshotCorrecao };

const centavos = (v: string): number => Math.round(Number(v) * 100);

export function validarPlano(plano: unknown): string[] {
  const erros: string[] = [];
  const p = plano as Partial<PlanoCorrecao> | null;
  if (!p || typeof p !== "object") return ["plano ausente ou ilegível"];
  if (p.base !== "compraDireta") erros.push(`base não suportada: ${String(p.base)} (somente "compraDireta")`);
  if (!Array.isArray(p.remover) || p.remover.length === 0) return [...erros, "plano sem registros em `remover`"];
  if (p.remover.length > MAX_REGISTROS_POR_PLANO) erros.push(`plano com ${p.remover.length} registros; o máximo é ${MAX_REGISTROS_POR_PLANO} (sem exclusão em lote)`);
  const vistos = new Set<string>();
  p.remover.forEach((r, i) => {
    const rot = `registro ${i + 1}`;
    if (!r || typeof r !== "object") return void erros.push(`${rot}: inválido`);
    if (typeof r.id !== "string" || !UUID.test(r.id)) erros.push(`${rot}: id ausente ou inválido`);
    else if (vistos.has(r.id.toLowerCase())) erros.push(`${rot}: id repetido`);
    else vistos.add(r.id.toLowerCase());
    for (const campo of ["unidade", "data", "motivo", "valor"] as const) if (typeof r[campo] !== "string" || r[campo] === "") erros.push(`${rot}: campo "${campo}" ausente`);
    if (typeof r.data === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) erros.push(`${rot}: data deve ser AAAA-MM-DD`);
    if (typeof r.valor === "string" && !Number.isFinite(Number(r.valor))) erros.push(`${rot}: valor inválido`);
    if (!r.substituta || typeof r.substituta.motivo !== "string" || typeof r.substituta.valor !== "string" || r.substituta.motivo === "") erros.push(`${rot}: substituta incompleta`);
    else if (r.substituta.motivo === r.motivo) erros.push(`${rot}: a substituta precisa ter motivo diferente do registro removido`);
  });
  return erros;
}

/** Confere id, unidade, data, motivo e valor do registro, e a existência da substituta com o mesmo valor. */
export async function verificarPreCondicoes(plano: PlanoCorrecao, banco: Pick<BancoCorrecao, "buscarPorIds" | "buscarDoDia">): Promise<{ erros: string[]; registros: RegistroBanco[] }> {
  const erros: string[] = [];
  const ids = plano.remover.map((r) => r.id);
  const encontrados = await banco.buscarPorIds(ids);
  const registros: RegistroBanco[] = [];
  for (const alvo of plano.remover) {
    const atual = encontrados.find((e) => e.id.toLowerCase() === alvo.id.toLowerCase());
    if (!atual) { erros.push(`id ${alvo.id} não existe no banco (já removido ou inexistente)`); continue; }
    const divergencias: string[] = [];
    if (atual.unidade !== alvo.unidade) divergencias.push(`unidade ${atual.unidade} ≠ ${alvo.unidade}`);
    if (atual.data !== alvo.data) divergencias.push(`data ${atual.data} ≠ ${alvo.data}`);
    if (atual.motivo !== alvo.motivo) divergencias.push(`motivo "${atual.motivo}" ≠ "${alvo.motivo}"`);
    if (centavos(atual.valor) !== centavos(alvo.valor)) divergencias.push(`valor ${atual.valor} ≠ ${alvo.valor}`);
    if (divergencias.length) { erros.push(`id ${alvo.id} divergente do plano: ${divergencias.join("; ")}`); continue; }
    const dia = await banco.buscarDoDia(alvo.unidade, alvo.data);
    const sub = dia.find((l) => l.motivo === alvo.substituta.motivo);
    if (!sub) erros.push(`id ${alvo.id}: a chave substituta "${alvo.substituta.motivo}" não existe no banco em ${alvo.unidade} ${alvo.data}`);
    else if (centavos(sub.valor) !== centavos(alvo.substituta.valor)) erros.push(`id ${alvo.id}: a substituta "${alvo.substituta.motivo}" vale ${sub.valor}, o plano esperava ${alvo.substituta.valor}`);
    registros.push(atual);
  }
  return { erros, registros };
}

const igual = (a: SnapshotTabela, b: SnapshotTabela) => a.n === b.n && a.hash === b.hash;

export async function executarCorrecao(plano: unknown, banco: BancoCorrecao, opcoes: OpcoesCorrecao): Promise<ResultadoCorrecao> {
  const errosPlano = validarPlano(plano);
  if (errosPlano.length) return { status: "plano-invalido", erros: errosPlano };
  const p = plano as PlanoCorrecao;
  const ids = p.remover.map((r) => r.id);

  const { erros, registros } = await verificarPreCondicoes(p, banco);
  if (erros.length) return { status: "pre-condicao-falhou", erros };

  const antes = await banco.snapshot(ids);
  const removeriaCentavos = registros.reduce((s, r) => s + centavos(r.valor), 0);
  if (!opcoes.confirmar) {
    return { status: "simulacao", registros, antes, removeriaCentavos, mensagem: "SIMULAÇÃO: nada foi gravado. Para gravar, repita o comando com --confirmar." };
  }

  if (!opcoes.gravarBackup) return { status: "pre-condicao-falhou", erros: ["backup não configurado — gravação recusada"] };
  let backup: string;
  try {
    backup = await opcoes.gravarBackup(registros);
  } catch (e) {
    return { status: "pre-condicao-falhou", erros: [`falha ao gravar o backup (${e instanceof Error ? e.message : String(e)}) — nada foi alterado`] };
  }

  try {
    await banco.transacao(async (tx) => {
      // pré-condições de novo, DENTRO da transação (nada mudou entre a simulação e a gravação)
      const dentro = await verificarPreCondicoes(p, tx);
      if (dentro.erros.length) throw new Error(`pré-condição falhou na transação: ${dentro.erros.join(" | ")}`);
      const antesN = await tx.contarCompraDireta();
      const removidos = await tx.deletarPorIds(ids);
      if (removidos !== ids.length) throw new Error(`removidos ${removidos}, esperado exatamente ${ids.length} — transação revertida`);
      const depoisN = await tx.contarCompraDireta();
      if (depoisN !== antesN - ids.length) throw new Error(`contagem após a exclusão (${depoisN}) diverge do esperado (${antesN - ids.length}) — transação revertida`);
      // nenhum outro registro mudou entre o snapshot de referência e o commit (inclui alterações concorrentes)
      const semAlvos = await tx.snapshotSemAlvos(ids);
      if (!igual(semAlvos, antes.compraDiretaSemAlvos)) throw new Error("os demais registros de compra_direta diferem da referência (alteração concorrente?) — transação revertida");
    });
  } catch (e) {
    return { status: "revertido", erro: e instanceof Error ? e.message : String(e), antes };
  }

  const depois = await banco.snapshot(ids);
  const errosPos: string[] = [];
  if (!igual(depois.compraDiretaSemAlvos, antes.compraDiretaSemAlvos)) errosPos.push("os demais registros de compra_direta mudaram");
  for (const [tabela, ref] of Object.entries(antes.tabelas)) {
    const atual = depois.tabelas[tabela];
    if (tabela === "compra_direta") {
      if (!atual || atual.n !== ref.n - ids.length) errosPos.push(`compra_direta: contagem ${atual?.n} ≠ ${ref.n - ids.length}`);
    } else if (!atual || !igual(atual, ref)) errosPos.push(`tabela ${tabela} mudou`);
  }
  if (errosPos.length) return { status: "falha-pos-validacao", erros: errosPos, backup, antes, depois };
  return { status: "gravado", removidos: ids.length, backup, antes, depois, centavosRemovidos: removeriaCentavos };
}
