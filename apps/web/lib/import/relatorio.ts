import type { TipoBase } from "@painel/shared";
import { estrategiaGravacao } from "../rules/deduplicacao";
import { CHAVES_POR_BASE } from "../rules/chaves";
import type { ResultadoParse, RegistroBase } from "./tipos";

export interface RelatorioImportacao {
  tipoBase: TipoBase;
  totalRegistrosLidos: number;
  totalValidos: number;
  totalRejeitados: number;
  somaValor: number;
  porFilial: { unidade: string; registros: number; somaValor: number }[];
  porData: { data: string; registros: number; somaValor: number }[];
  rejeitados: { linhaOrigem: number; motivo: string }[];
  /**
   * Apenas para bases com chave (upsert): quantos registros colidem na
   * mesma chave dentro do próprio arquivo importado (o upsert final
   * ficaria com 1 registro por chave — o último lido). Ajuda a detectar
   * arquivo com linhas conflitantes antes de gravar.
   */
  colisoesDeChaveNoArquivo: number;
}

function chaveDoRegistro(registro: RegistroBase, camposChave: readonly string[]): string {
  const partes = camposChave.map((campo) => {
    if (campo === "unidade_id") return registro.unidade;
    if (campo === "data") return registro.data.toISOString().slice(0, 10);
    return registro.extras[campo] ?? "";
  });
  return partes.join("||");
}

export function gerarRelatorioImportacao(
  tipoBase: TipoBase,
  resultado: ResultadoParse
): RelatorioImportacao {
  const { registros, rejeitados } = resultado;

  const porFilialMap = new Map<string, { registros: number; somaValor: number }>();
  const porDataMap = new Map<string, { registros: number; somaValor: number }>();
  let somaValor = 0;

  for (const r of registros) {
    somaValor += r.valor;

    const filialAtual = porFilialMap.get(r.unidade) ?? { registros: 0, somaValor: 0 };
    filialAtual.registros += 1;
    filialAtual.somaValor += r.valor;
    porFilialMap.set(r.unidade, filialAtual);

    const dataChave = r.data.toISOString().slice(0, 10);
    const dataAtual = porDataMap.get(dataChave) ?? { registros: 0, somaValor: 0 };
    dataAtual.registros += 1;
    dataAtual.somaValor += r.valor;
    porDataMap.set(dataChave, dataAtual);
  }

  let colisoesDeChaveNoArquivo = 0;
  if (estrategiaGravacao(tipoBase) === "upsert_por_chave") {
    const camposChave = CHAVES_POR_BASE[tipoBase];
    const vistos = new Set<string>();
    for (const r of registros) {
      const chave = chaveDoRegistro(r, camposChave);
      if (vistos.has(chave)) colisoesDeChaveNoArquivo += 1;
      vistos.add(chave);
    }
  }

  return {
    tipoBase,
    totalRegistrosLidos: registros.length + rejeitados.length,
    totalValidos: registros.length,
    totalRejeitados: rejeitados.length,
    somaValor,
    porFilial: [...porFilialMap.entries()]
      .map(([unidade, v]) => ({ unidade, ...v }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade)),
    porData: [...porDataMap.entries()]
      .map(([data, v]) => ({ data, ...v }))
      .sort((a, b) => a.data.localeCompare(b.data)),
    rejeitados: rejeitados.map((r) => ({ linhaOrigem: r.linhaOrigem, motivo: r.motivo })),
    colisoesDeChaveNoArquivo,
  };
}
