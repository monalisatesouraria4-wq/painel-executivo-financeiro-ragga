"use client";

import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { Secao } from "@/components/ui/PainelAnalitico";
import { resumirConferenciaGerencial } from "@/lib/services/conferenciaGerencial";
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

function BigNumberCard({ titulo, valor, alerta, detalhe }: { titulo: string; valor: string; alerta?: boolean; detalhe?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-0.5 text-2xl font-semibold ${alerta ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-[11px] leading-snug text-foreground/50">{detalhe}</p>}
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

  // Camada gerencial: conferidas (números da matriz) + em atraso (X × caixas cadastradas do dia) = previstas.
  const gerencial = resumirConferenciaGerencial(linhasOrdenadas);
  const pontosDeAtencao = gerencial.lojas.filter((l) => l.atrasadas > 0).slice(0, 5);
  const textoPercentual = (v: number | null) => (v === null ? "—" : `${formatadorPercentual.format(v)}%`);
  const { rede } = gerencial;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-ragga-blue-dark">
        CONFERÊNCIA DE CAIXAS | {formatadorData.format(dados.periodoInicio)} a {formatadorData.format(dados.periodoFim)}
      </h2>

      {/* 1) Resumo do período selecionado */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigNumberCard titulo="Caixas previstos" valor={String(rede.previstas)} detalhe="Conferidos + em atraso" />
        <BigNumberCard titulo="Caixas conferidos" valor={String(rede.conferidas)} />
        <BigNumberCard titulo="Caixas em atraso" valor={String(rede.atrasadas)} alerta={rede.atrasadas > 0} detalhe="Dias marcados com X × caixas cadastradas da loja" />
        <BigNumberCard titulo="Percentual de conferência" valor={textoPercentual(rede.percentual)} detalhe="Conferidos ÷ previstos" />
      </div>
      {gerencial.registrosMapoliFimDeSemana > 0 && (
        <p className="text-[11px] text-foreground/45">MAPOLI aos sábados e domingos não entra nos indicadores ({gerencial.registrosMapoliFimDeSemana} registros).</p>
      )}

      <Secao titulo="Principais pontos de atenção">
        {pontosDeAtencao.length === 0 ? (
          <p className="text-sm text-foreground/45">Nenhuma loja com caixas em atraso no período.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {pontosDeAtencao.map((l, i) => (
              <li key={l.unidade} className="rounded-lg border border-semaforo-vermelho/20 bg-semaforo-vermelho/5 px-3 py-2">
                <p className="text-xs text-foreground/50">{i + 1}º em atraso</p>
                <p className="text-base font-bold text-ragga-blue-dark">{l.unidade}</p>
                <p className="text-sm font-semibold tabular-nums text-semaforo-vermelho">
                  {l.atrasadas} {l.atrasadas === 1 ? "caixa em atraso" : "caixas em atraso"}
                </p>
                <p className="text-xs text-foreground/60">
                  {l.conferidas} conferidos · {textoPercentual(l.percentual)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* Matriz diária (dias do período) logo após os pontos de atenção */}
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
        Legenda: <span className="font-medium text-semaforo-verde">número verde</span> = caixas conferidos naquele dia ·{" "}
        <span className="font-semibold text-semaforo-vermelho">X</span> = atraso de conferência (conta as caixas cadastradas da loja naquele dia) ·{" "}
        <span className="font-medium text-foreground/70">0</span> = nenhuma caixa conferida (não é atraso).
      </p>

      <Secao titulo="Ranking de lojas">
        {gerencial.lojas.length === 0 ? (
          <p className="text-sm text-foreground/45">Sem dados para o período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-2 pr-4">Ranking</th>
                  <th className="px-3 py-2">Loja</th>
                  <th className="px-3 py-2">Caixas conferidos</th>
                  <th className="px-3 py-2">Caixas em atraso</th>
                  <th className="px-3 py-2">% de conferência</th>
                </tr>
              </thead>
              <tbody>
                {gerencial.lojas.map((l, i) => (
                  <tr key={l.unidade} className={`border-b border-ragga-blue/5 ${l.atrasadas > 0 ? "bg-semaforo-vermelho/5" : ""}`}>
                    <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                    <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                    <td className="px-3">{l.conferidas}</td>
                    <td className={`px-3 ${l.atrasadas > 0 ? "font-semibold text-semaforo-vermelho" : ""}`}>{l.atrasadas}</td>
                    <td className="px-3 font-semibold text-ragga-blue-dark">{textoPercentual(l.percentual)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                  <td className="py-2.5 pr-4" colSpan={2}>REDE</td>
                  <td className="px-3">{rede.conferidas}</td>
                  <td className="px-3">{rede.atrasadas}</td>
                  <td className="px-3">{textoPercentual(rede.percentual)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-foreground/40">Ordenado por mais caixas em atraso; empate: menor % de conferência.</p>
      </Secao>
    </div>
  );
}
