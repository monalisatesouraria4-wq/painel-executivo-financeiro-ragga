import type { RegistroBase } from "./tipos";

/**
 * Identificação por OCORRÊNCIA dos lançamentos de Quebra de Caixa.
 *
 * Problema: a chave natural (loja + data + conferente + operador + cpf + motivo) NÃO identifica um lançamento — o mesmo operador
 * pode ter vários lançamentos legítimos iguais no mesmo dia (ex.: 5 erros de despacho de R$ 6,50) ou com valores diferentes
 * (R$ 55,30 e R$ 6,50). O valor continua FORA da chave (corrigir um valor atualiza o registro, não cria outro), então o que
 * distingue as repetições é um número de ocorrência.
 *
 * Regra: dentro de cada grupo de lançamentos com a mesma chave natural, `ocorrencia` = posição do lançamento ordenado por VALOR
 * CRESCENTE (empate: linha de origem, só para ser determinístico — com valores iguais as ocorrências são intercambiáveis).
 *
 * Estabilidade (por que não o número da linha):
 *  - reordenar/filtrar/inserir linhas na planilha NÃO muda nada (depende só do conjunto de valores do grupo);
 *  - corrigir um valor atualiza a mesma ocorrência (ou, no máximo, troca valores entre ocorrências do MESMO grupo — o total do
 *    grupo fica correto e nenhum registro novo é criado);
 *  - incluir uma ocorrência acrescenta uma posição (as demais podem deslocar valores entre si dentro do grupo, sem perder nem
 *    duplicar nenhum lançamento); remover uma ocorrência deixa a de maior número "só no banco" (nunca excluída pelo fluxo
 *    oficial de upsert).
 */
export const CAMPOS_CHAVE_NATURAL_QUEBRA = ["conferente", "operador", "cpf", "motivo"] as const;

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Chave natural (sem valor e sem ocorrência) — a chave oficial ANTES da migração 0004. */
export function chaveNaturalQuebra(r: Pick<RegistroBase, "unidade" | "data" | "extras">): string {
  return [r.unidade, dia(r.data), ...CAMPOS_CHAVE_NATURAL_QUEBRA.map((c) => r.extras[c] ?? "")].join("|");
}

/** Chave oficial atual: chave natural + ocorrência. */
export function chaveOficialQuebra(r: Pick<RegistroBase, "unidade" | "data" | "extras">): string {
  return `${chaveNaturalQuebra(r)}|${r.extras.ocorrencia ?? "1"}`;
}

/** Devolve os mesmos registros (mesma ordem) com `extras.ocorrencia` preenchido. Não altera data, valor nem demais campos. */
export function numerarOcorrenciasQuebra(registros: RegistroBase[]): RegistroBase[] {
  const grupos = new Map<string, RegistroBase[]>();
  for (const r of registros) {
    const k = chaveNaturalQuebra(r);
    const g = grupos.get(k);
    if (g) g.push(r);
    else grupos.set(k, [r]);
  }
  const numero = new Map<RegistroBase, number>();
  for (const g of grupos.values()) {
    [...g].sort((a, b) => a.valor - b.valor || a.linhaOrigem - b.linhaOrigem).forEach((r, i) => numero.set(r, i + 1));
  }
  return registros.map((r) => ({ ...r, extras: { ...r.extras, ocorrencia: String(numero.get(r)) } }));
}

/** Garantia de gravação: nenhuma chave oficial pode se repetir (senão o upsert descartaria lançamentos em silêncio). */
export function chavesOficiaisRepetidas(registros: RegistroBase[]): string[] {
  const vistos = new Set<string>();
  const repetidas: string[] = [];
  for (const r of registros) {
    const k = chaveOficialQuebra(r);
    if (vistos.has(k)) repetidas.push(k);
    vistos.add(k);
  }
  return repetidas;
}

/** Estado de uma ocorrência já gravada (ou tratada como gravada) no banco, por chave natural. */
export interface OcorrenciaExistente {
  /** `chaveNaturalQuebra` do registro existente. */
  chaveNatural: string;
  ocorrencia: number;
  valor: number;
}

const centavos = (v: number) => Math.round(v * 100);

/**
 * ALINHA os números de ocorrência do lote ao que JÁ existe no banco, para que a identidade de cada ocorrência seja preservada
 * quando um valor é corrigido (a numeração "por valor crescente" sozinha pode trocar valores entre ocorrências do mesmo grupo):
 *  1) cada ocorrência existente é pareada com um lançamento do arquivo de MESMO valor e mantém o seu número (nada é atualizado);
 *  2) o que sobrar do arquivo é pareado, em ordem de valor, com as ocorrências existentes que sobraram (isso É a correção de valor:
 *     a mesma ocorrência recebe o novo valor);
 *  3) lançamentos excedentes ganham números NOVOS (maior número existente + 1, …): são ocorrências adicionais;
 *  4) ocorrências existentes sem lançamento correspondente ficam intactas (nada é excluído).
 * Sem estado existente para a chave natural, vale a numeração padrão (valor crescente). Determinístico.
 */
export function alinharOcorrenciasComExistentes(registros: RegistroBase[], existentes: OcorrenciaExistente[]): RegistroBase[] {
  const exPorChave = new Map<string, OcorrenciaExistente[]>();
  for (const e of existentes) exPorChave.set(e.chaveNatural, [...(exPorChave.get(e.chaveNatural) ?? []), e]);

  const grupos = new Map<string, RegistroBase[]>();
  for (const r of registros) {
    const k = chaveNaturalQuebra(r);
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }

  const numero = new Map<RegistroBase, number>();
  for (const [k, g] of grupos) {
    const ex = (exPorChave.get(k) ?? []).slice().sort((a, b) => a.ocorrencia - b.ocorrencia);
    const ordenados = [...g].sort((a, b) => a.valor - b.valor || a.linhaOrigem - b.linhaOrigem);
    if (ex.length === 0) {
      ordenados.forEach((r, i) => numero.set(r, i + 1));
      continue;
    }
    const livres = [...ordenados];
    const exSobra: OcorrenciaExistente[] = [];
    const usados: number[] = ex.map((e) => e.ocorrencia);
    for (const e of ex) {
      const i = livres.findIndex((r) => centavos(r.valor) === centavos(e.valor));
      if (i >= 0) { numero.set(livres[i], e.ocorrencia); livres.splice(i, 1); } else exSobra.push(e);
    }
    exSobra.sort((a, b) => a.valor - b.valor || a.ocorrencia - b.ocorrencia);
    while (livres.length > 0 && exSobra.length > 0) numero.set(livres.shift()!, exSobra.shift()!.ocorrencia);
    let proximo = Math.max(0, ...usados) + 1;
    for (const r of livres) numero.set(r, proximo++);
  }
  return registros.map((r) => ({ ...r, extras: { ...r.extras, ocorrencia: String(numero.get(r)) } }));
}
