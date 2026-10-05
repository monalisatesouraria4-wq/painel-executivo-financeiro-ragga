import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { QuebraLojasPainel } from "./QuebraLojasPainel";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

// timeZone: "UTC" — data pura (meia-noite UTC), mesmo padrão de ConferenciaTab.tsx.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Sub-aba Quebra de Caixa (`renderQuebraCaixa`, linha 5336 do legado).
 * KPIs: Registros no período, Total Geral (warn se >0). A tabela principal
 * agora é a análise por LOJA (`QuebraLojasPainel`: REDE → LOJA → OPERADOR/MOTIVO,
 * com comparativo de período) + tabela detalhada por lançamento (Data, Filial, Valor, Motivo,
 * Operador, expansível Conferente/CPF). Ordenação apenas por Data
 * decrescente, sem reordenar por filial — igual ao legado.
 *
 * Filtro de Loja + Período (item 2 da etapa de revisão) vive no
 * componente pai (`ControlesCaixaTabs`) — em modo "Data de referência" o
 * filtro de loja é aplicado aqui, client-side, sobre `detalhado`
 * (recalculando `porOperador`/totais a partir do subconjunto).
 */
export function QuebraCaixaTab({
  dados,
  unidade,
  lojaFiltro,
}: {
  dados: ControlesCaixaData["quebraCaixa"];
  unidade?: CodigoUnidade;
  /** Loja selecionada no filtro da aba (em modo período o filtro já vem aplicado no servidor). */
  lojaFiltro?: CodigoUnidade;
}) {
  const detalhado = unidade ? dados.detalhado.filter((l) => l.unidade === unidade) : dados.detalhado;
  const disponivel = unidade ? detalhado.length > 0 : dados.disponivel;
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

      <QuebraLojasPainel detalhadoAtual={detalhado} janela={{ inicio: dados.periodoInicio ?? null, fim: dados.periodoFim ?? null }} lojaFiltro={lojaFiltro ?? unidade} />

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
