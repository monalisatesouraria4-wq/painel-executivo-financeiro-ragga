import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import type { ControlesCaixaData, QuebraOperadorLinha } from "@/lib/services/controlesCaixa";

// timeZone: "UTC" — data pura (meia-noite UTC), mesmo padrão de ConferenciaTab.tsx.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Mesmo agrupamento (CPF+Operador) já usado no serviço — recalculado aqui só quando o filtro de loja reduz o conjunto de lançamentos. */
function agruparPorOperador(detalhado: ControlesCaixaData["quebraCaixa"]["detalhado"]): QuebraOperadorLinha[] {
  const mapa = new Map<string, QuebraOperadorLinha>();
  for (const r of detalhado) {
    const chave = `${r.cpf}||${r.operador}`;
    const atual = mapa.get(chave) ?? { operador: r.operador, cpf: r.cpf, quantidade: 0, valorTotal: 0 };
    atual.quantidade += 1;
    atual.valorTotal = arred(atual.valorTotal + r.valor);
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => b.valorTotal - a.valorTotal);
}

/**
 * Sub-aba Quebra de Caixa (`renderQuebraCaixa`, linha 5336 do legado).
 * KPIs: Registros no período, Total Geral (warn se >0). Tabela
 * consolidada por Operador (chave CPF+Operador, ordenada por valor
 * desc.) + tabela detalhada por lançamento (Data, Filial, Valor, Motivo,
 * Operador, expansível Conferente/CPF). Ordenação apenas por Data
 * decrescente, sem reordenar por filial — igual ao legado.
 *
 * Filtro de Loja + Período (item 2 da etapa de revisão) vive no
 * componente pai (`ControlesCaixaTabs`) — em modo "Data de referência" o
 * filtro de loja é aplicado aqui, client-side, sobre `detalhado`
 * (recalculando `porOperador`/totais a partir do subconjunto).
 */
export function QuebraCaixaTab({ dados, unidade }: { dados: ControlesCaixaData["quebraCaixa"]; unidade?: CodigoUnidade }) {
  const detalhado = unidade ? dados.detalhado.filter((l) => l.unidade === unidade) : dados.detalhado;
  const disponivel = unidade ? detalhado.length > 0 : dados.disponivel;
  const porOperador = unidade ? agruparPorOperador(detalhado) : dados.porOperador;
  const totalGeral = unidade ? arred(detalhado.reduce((s, l) => s + l.valor, 0)) : (dados.totalGeral ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-md">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Registros no período</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? detalhado.length : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total Geral de Quebra</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(totalGeral) : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Consolidado por Operador</h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Operador</th>
                <th className="px-4 py-2">CPF</th>
                <th className="px-4 py-2">Quantidade</th>
                <th className="px-4 py-2">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {porOperador.length === 0 ? (
                <EstadoVazio colSpan={4} />
              ) : (
                porOperador.map((linha) => (
                  <tr key={`${linha.cpf}-${linha.operador}`} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.operador}</td>
                    <td className="px-4 py-2">{linha.cpf}</td>
                    <td className="px-4 py-2">{linha.quantidade}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.valorTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Detalhamento por lançamento</h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Loja</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Motivo</th>
                <th className="px-4 py-2">Operador</th>
                <th className="px-4 py-2">Conferente</th>
                <th className="px-4 py-2">CPF</th>
              </tr>
            </thead>
            <tbody>
              {detalhado.length === 0 ? (
                <EstadoVazio colSpan={7} />
              ) : (
                detalhado.map((linha, i) => (
                  <tr key={`${linha.unidade}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2">{formatadorData.format(linha.data)}</td>
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.valor)}</td>
                    <td className="px-4 py-2">{linha.motivo}</td>
                    <td className="px-4 py-2">{linha.operador}</td>
                    <td className="px-4 py-2">{linha.conferente}</td>
                    <td className="px-4 py-2">{linha.cpf}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
