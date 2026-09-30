"use client";

import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/**
 * Sub-aba Conferência — reescrita visual como espelho do Excel de
 * Conferência fornecido (item 7 da etapa de revisão): cards de resumo +
 * matriz Responsável/Filial/Qtd. Caixas × dias do ciclo. Reaproveita
 * 100% os dados já calculados em `buscarConferenciaDoPeriodo`
 * (`lib/services/controlesCaixa.ts`) — `linhas[].dias[]` já traz um
 * registro por (loja, dia) com `qtdConferidos`/`emAtraso`/
 * `respConferencia`; esta tela só reorganiza (pivota) esse array em uma
 * matriz dia-a-dia, sem nenhuma consulta nova nem reclassificação.
 * `calcularStatusConferencia`/`calcularPendente` (regras já validadas)
 * continuam intocados — usados aqui apenas para decidir a cor da célula
 * diária (conferido/atraso/não conferido), nenhum limite novo.
 */
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const formatadorDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "UTC" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function BigNumberCard({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${alerta ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{valor}</p>
    </Card>
  );
}

/** Lista de dias [periodoInicio..periodoFim] (inclusive), em ordem — colunas da matriz. */
function diasDoPeriodo(inicio: Date, fim: Date): Date[] {
  const dias: Date[] = [];
  const cursor = new Date(inicio.getTime());
  while (cursor.getTime() <= fim.getTime()) {
    dias.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

function CelulaDia({ dia }: { dia: { qtdConferidos: number | null; emAtraso: boolean } | undefined }) {
  if (!dia) return <td className="border border-ragga-blue/5 px-2 py-1.5 text-center text-foreground/30">—</td>;
  if (dia.emAtraso) {
    return (
      <td className="border border-ragga-blue/5 bg-semaforo-vermelho/10 px-2 py-1.5 text-center font-semibold text-semaforo-vermelho">
        X
      </td>
    );
  }
  const conferido = dia.qtdConferidos ?? 0;
  return (
    <td
      className={`border border-ragga-blue/5 px-2 py-1.5 text-center ${
        conferido > 0 ? "bg-semaforo-verde/10 text-semaforo-verde" : "text-foreground/50"
      }`}
    >
      {conferido}
    </td>
  );
}

export function ConferenciaTab({ dados, unidade }: { dados: ControlesCaixaData["conferencia"]; unidade?: CodigoUnidade }) {
  if (!dados.disponivel || !dados.periodoInicio || !dados.periodoFim) {
    return <p className="text-sm text-foreground/50">Sem dados para o período.</p>;
  }

  const dias = diasDoPeriodo(dados.periodoInicio, dados.periodoFim);
  const linhasBase = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  // Ordem natural das lojas (BG 01..BG 13, IS 01..03, ROBS, MAPOLI) — nunca alfabética simples.
  const linhasPorUnidade = new Map(linhasBase.map((l) => [l.unidade, l]));
  const linhasOrdenadas = UNIDADES.map((u) => linhasPorUnidade.get(u)).filter((l): l is NonNullable<typeof l> => l !== undefined);

  const totalCaixasRede = unidade ? linhasOrdenadas.reduce((s, l) => s + (l.qtdCadastrados ?? 0), 0) : (dados.totalCaixasRede ?? 0);
  const totalConferidosRede = unidade ? linhasOrdenadas.reduce((s, l) => s + (l.qtdConferidos ?? 0), 0) : (dados.totalConferidosRede ?? 0);
  const totalEmAtraso = unidade ? linhasOrdenadas.reduce((s, l) => s + l.atrasos, 0) : (dados.totalEmAtraso ?? 0);
  const percentualConferidoRede = unidade
    ? linhasOrdenadas.length > 0
      ? linhasOrdenadas.reduce((s, l) => s + (l.percentualConferido ?? 0), 0) / linhasOrdenadas.length
      : 0
    : (dados.percentualConferidoRede ?? 0);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-ragga-blue-dark">
        CONFERÊNCIA DE CAIXAS | {formatadorData.format(dados.periodoInicio)} a {formatadorData.format(dados.periodoFim)}
      </h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigNumberCard titulo="Caixas Cadastrados" valor={String(totalCaixasRede)} />
        <BigNumberCard titulo="Caixas Conferidos" valor={String(totalConferidosRede)} />
        <BigNumberCard titulo="Em Atraso" valor={String(totalEmAtraso)} alerta={totalEmAtraso > 0} />
        <BigNumberCard titulo="% Conferido" valor={`${formatadorPercentual.format(percentualConferidoRede)}%`} />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-ragga-blue/10 bg-ragga-bg text-left uppercase tracking-wide text-foreground/50">
              <th className="sticky left-0 z-10 border border-ragga-blue/5 bg-ragga-bg px-2 py-2">Resp. pela conferência</th>
              <th className="border border-ragga-blue/5 px-2 py-2">Filial</th>
              <th className="border border-ragga-blue/5 px-2 py-2">Qtd. Caixas</th>
              {dias.map((dia) => (
                <th key={dia.toISOString()} className="border border-ragga-blue/5 px-2 py-2 text-center">
                  {formatadorDia.format(dia)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhasOrdenadas.length === 0 ? (
              <tr>
                <td colSpan={3 + dias.length} className="px-4 py-6 text-center text-foreground/50">
                  Sem dados para o período.
                </td>
              </tr>
            ) : (
              linhasOrdenadas.map((linha) => {
                const diaPorData = new Map(linha.dias.map((d) => [d.data.toISOString().slice(0, 10), d]));
                const respMaisRecente = [...linha.dias].reverse().find((d) => d.respConferencia)?.respConferencia ?? "—";
                return (
                  <tr key={linha.unidade} className="odd:bg-white even:bg-ragga-bg/30">
                    <td className="sticky left-0 z-10 border border-ragga-blue/5 bg-inherit px-2 py-1.5 font-medium text-ragga-blue-dark">
                      {respMaisRecente}
                    </td>
                    <td className="border border-ragga-blue/5 px-2 py-1.5 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                    <td className="border border-ragga-blue/5 px-2 py-1.5 text-center">{linha.qtdCadastrados ?? "—"}</td>
                    {dias.map((dia) => (
                      <CelulaDia key={dia.toISOString()} dia={diaPorData.get(dia.toISOString().slice(0, 10))} />
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-foreground/50">
        Legenda: número = caixas conferidos naquele dia · <span className="font-medium text-foreground/70">0</span> = nenhum
        caixa conferido · <span className="font-semibold text-semaforo-vermelho">X</span> = em atraso.
      </p>
    </div>
  );
}
