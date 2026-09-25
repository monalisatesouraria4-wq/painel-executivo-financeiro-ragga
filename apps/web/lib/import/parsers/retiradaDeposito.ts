import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "./listaSimples";
import type { ResultadoParse } from "../tipos";

function normalizarClassificacao(valor: string): string {
  return valor
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Parser de Retirada Depósito — regra oficial confirmada a partir do
 * código-fonte do painel HTML atual (`lerArquivoRetirada` +
 * `isRetiradaDeposito`, ver docs/regras-negocio.md). Fonte oficial:
 * `Retirada Depósito.xlsx`.
 *
 * Só entram no resultado as linhas cujo campo `Motivo` seja EXATAMENTE
 * "DEPOSITO" (comparação sem acento/caixa, igual ao painel atual). As
 * demais classificações presentes no mesmo arquivo (ex. "SUPRIMENTO")
 * são válidas como leitura, mas ficam fora do escopo deste indicador —
 * reportadas como excluídas, não como erro de dado.
 */
export function parseRetiradaDeposito(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const bruto = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.retirada_deposito);

  const registros = bruto.registros.filter(
    (r) => normalizarClassificacao(r.extras.motivo ?? "") === "DEPOSITO"
  );
  const excluidosPorMotivo = bruto.registros
    .filter((r) => normalizarClassificacao(r.extras.motivo ?? "") !== "DEPOSITO")
    .map((r) => ({
      linhaOrigem: r.linhaOrigem,
      motivo: `Motivo = "${r.extras.motivo || "(vazio)"}" — fora do escopo de Retirada Depósito (só "DEPOSITO" entra)`,
      valoresBrutos: { unidade: r.unidade, data: r.data.toISOString().slice(0, 10), motivo: r.extras.motivo },
    }));

  return {
    registros,
    rejeitados: [...bruto.rejeitados, ...excluidosPorMotivo],
  };
}
