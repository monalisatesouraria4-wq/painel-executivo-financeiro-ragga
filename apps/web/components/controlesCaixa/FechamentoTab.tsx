import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Sub-aba Fechamento — incorpora aqui o mesmo esquema/dados de
 * "Abertura e Fechamento" (tela separada removida do menu nesta etapa,
 * ver `lib/services/aberturaFechamento.server.ts`, cujo serviço não foi
 * alterado). Big numbers + tabela detalhada, sem tolerância inventada:
 * "Total de Caixas Operados" (rótulo corrigido nesta etapa — mesmo valor
 * de sempre, `abertos`/`dados.abertos` = total de linhas com abertura
 * registrada na data de referência; NÃO é "caixas atualmente em aberto",
 * conceito que é `emAberto`, usado só na "Diferença" abaixo. Um caixa
 * aberto em 28/09 com fechamento após a meia-noite, em 29/09, continua
 * contado em 28/09 — é a mesma linha, chave por data de abertura);
 * "Diferença" = caixas operados − caixas fechados (= `emAberto`, já
 * calculado no serviço); "Diferença nos fechamentos" = soma real de
 * `difFechamento` (diferença identificada pelo operador no fechamento).
 *
 * Filtro de Loja (item 2 da etapa de revisão, modo "Data de referência"):
 * filtra `linhas` client-side e recalcula os big numbers a partir do
 * subconjunto filtrado — a mesma fórmula já usada no serviço (nenhuma
 * regra nova), só aplicada sobre menos linhas.
 */
function BigNumberCard({ titulo, valor, disponivel }: { titulo: string; valor: string; disponivel: boolean }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
        {disponivel ? valor : "—"}
      </p>
    </Card>
  );
}

export function FechamentoTab({ dados, unidade }: { dados: AberturaFechamentoData; unidade?: CodigoUnidade }) {
  const linhas = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  const disponivel = unidade ? linhas.length > 0 : dados.disponivel;
  const abertos = unidade ? linhas.length : dados.abertos;
  const fechados = unidade ? linhas.filter((l) => l.fechado).length : dados.fechados;
  const emAberto = unidade ? linhas.filter((l) => l.situacao === "Aberto").length : dados.emAberto;
  const diferencaFinanceira = unidade ? linhas.reduce((s, l) => s + (l.difFechamento ?? 0), 0) : dados.diferencaFinanceira;

  return (
    <div className="space-y-4">
      {!disponivel && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          Sem dados para esta referência.
          {dados.dataMaisRecenteDisponivel && (
            <span className="text-foreground/50"> Última data com registro: {dados.dataMaisRecenteDisponivel.toLocaleDateString("pt-BR", { timeZone: "UTC" })}.</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigNumberCard titulo="Total de Caixas Operados" valor={String(abertos)} disponivel={disponivel} />
        <BigNumberCard titulo="Caixas Fechados" valor={String(fechados)} disponivel={disponivel} />
        <BigNumberCard titulo="Diferença" valor={String(emAberto)} disponivel={disponivel} />
        <BigNumberCard
          titulo="Diferença nos fechamentos realizados pelo operador"
          valor={formatadorMoeda.format(diferencaFinanceira)}
          disponivel={disponivel}
        />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">Caixa</th>
              <th className="px-4 py-2">Movimento</th>
              <th className="px-4 py-2">Abertura</th>
              <th className="px-4 py-2">Fechamento</th>
              <th className="px-4 py-2">Operador</th>
              <th className="px-4 py-2">Situação</th>
              <th className="px-4 py-2">Dif. Fechamento</th>
              <th className="px-4 py-2">Dif. Conciliação</th>
              <th className="px-4 py-2">Dif. Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <EstadoVazio colSpan={10} />
            ) : (
              linhas.map((linha, i) => (
                <tr key={`${linha.unidade}-${linha.caixa}-${linha.movimento}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{linha.caixa}</td>
                  <td className="px-4 py-2">{linha.movimento}</td>
                  <td className="px-4 py-2">{linha.abertura ?? "—"}</td>
                  <td className="px-4 py-2">{linha.fechamento ?? "—"}</td>
                  <td className="px-4 py-2">{linha.operador ?? "—"}</td>
                  <td className="px-4 py-2">
                    {linha.situacao}
                    {linha.situacao === "Aberto" && (
                      <span className="ml-2 rounded bg-semaforo-amarelo/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-semaforo-amarelo">
                        Em aberto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{linha.difFechamento !== null ? formatadorMoeda.format(linha.difFechamento) : "—"}</td>
                  <td className="px-4 py-2">{linha.difConciliacao !== null ? formatadorMoeda.format(linha.difConciliacao) : "—"}</td>
                  <td className="px-4 py-2">{linha.difTotal !== null ? formatadorMoeda.format(linha.difTotal) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
