import type { TipoBase } from "@painel/shared";
import { estrategiaGravacao } from "../rules/deduplicacao";
import { CHAVES_POR_BASE } from "../rules/chaves";
import { chaveDoRegistro } from "./simularGravacao";
import type { RegistroBase } from "./tipos";

/**
 * Aplica de fato o merge de `registrosNovos` sobre `estadoExistente` e
 * retorna o novo array — a contraparte "real" de `simularGravacao`
 * (que só calcula contagens, sem produzir o array resultante). Usa
 * exatamente a mesma estratégia/chave já validada em
 * `lib/rules/deduplicacao.ts`/`lib/rules/chaves.ts`, sem reimplementar
 * nem alterar nenhuma regra — apenas materializa o resultado que
 * `simularGravacao` já descreve em números.
 *
 * Usada pela Atualização de Bases para manter o estado em memória do
 * navegador (nunca grava em banco real nesta etapa).
 */
export function aplicarGravacao(
  tipoBase: TipoBase,
  registrosNovos: RegistroBase[],
  estadoExistente: RegistroBase[]
): RegistroBase[] {
  const estrategia = estrategiaGravacao(tipoBase);

  if (estrategia === "upsert_por_chave") {
    const camposChave = CHAVES_POR_BASE[tipoBase];
    const porChave = new Map(estadoExistente.map((r) => [chaveDoRegistro(r, camposChave), r]));
    for (const registro of registrosNovos) {
      // Última ocorrência no arquivo vence — mesmo critério de simularGravacao.
      porChave.set(chaveDoRegistro(registro, camposChave), registro);
    }
    return [...porChave.values()];
  }

  // delete_periodo_insert: remove apenas o período coberto pelos novos registros.
  if (registrosNovos.length === 0) return estadoExistente;

  const tempos = registrosNovos.map((r) => r.data.getTime());
  const periodoInicio = Math.min(...tempos);
  const periodoFim = Math.max(...tempos);

  const preservados = estadoExistente.filter(
    (r) => r.data.getTime() < periodoInicio || r.data.getTime() > periodoFim
  );
  return [...preservados, ...registrosNovos];
}
