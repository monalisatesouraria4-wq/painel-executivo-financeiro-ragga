import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/**
 * Sub-aba PDV × Maquininha (`renderPdvMaquininha`, linha 2668 do legado).
 * KPIs: Total PDV, Total Maquininha, Diferença. Threshold de "diferença
 * zero" confirmado no legado: Math.abs(diferenca) > 0.005 ? warn : ok
 * (linha 2697) — tolerância de ponto flutuante, não faixa de negócio.
 *
 * Filtro de Loja + Período (item 2 da etapa de revisão) agora vive no
 * componente pai (`ControlesCaixaTabs`, filtro único compartilhado) —
 * em modo "Data de referência" o filtro de loja é aplicado aqui,
 * client-side, sobre `linhas` (recalculando os totais de rede a partir
 * do subconjunto); em modo "Período" o filtro já vem aplicado do
 * servidor e `unidade` chega como `undefined`.
 */
const TOLERANCIA_DIFERENCA_ZERO = 0.005;
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export function PdvMaquininhaTab({
  dados,
  dataReferencia,
  unidade,
}: {
  dados: ControlesCaixaData["pdvMaquininha"];
  dataReferencia: Date;
  unidade?: CodigoUnidade;
}) {
  const linhas = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  const disponivel = unidade ? linhas.length > 0 : dados.disponivel;
  const totalPdvRede = unidade ? linhas.reduce((s, l) => s + l.totalPdv, 0) : (dados.totalPdvRede ?? 0);
  const totalMaquininhaRede = unidade ? linhas.reduce((s, l) => s + l.totalMaquininha, 0) : (dados.totalMaquininhaRede ?? 0);
  const diferencaRede = unidade ? linhas.reduce((s, l) => s + l.diferenca, 0) : (dados.diferencaRede ?? 0);
  const statusRede = disponivel ? Math.abs(diferencaRede) > TOLERANCIA_DIFERENCA_ZERO : null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground/50">Consulta padrão (D-2): {formatadorData.format(dataReferencia)}.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total PDV</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(totalPdvRede) : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total Maquininha</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(totalMaquininhaRede) : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Diferença</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(diferencaRede) : "—"}
          </p>
          <div className="mt-2">
            {statusRede !== null ? (
              <StatusBadge tom={statusRede ? "warn" : "ok"} texto={statusRede ? "Divergente" : "Ok"} />
            ) : (
              <p className="text-xs text-foreground/50">Sem dados para o período</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">PDV</th>
              <th className="px-4 py-2">Maquininha</th>
              <th className="px-4 py-2">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <EstadoVazio colSpan={4} />
            ) : (
              linhas.map((linha) => (
                <tr key={linha.unidade} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.totalPdv)}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.totalMaquininha)}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.diferenca)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
