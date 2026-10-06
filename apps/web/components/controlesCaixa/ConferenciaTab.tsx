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

  // Camada gerencial (previsto × conferido no PERÍODO, por loja): agrega os mesmos `dias[]` já carregados e filtrados.
  const gerencial = resumirConferenciaGerencial(linhasOrdenadas);
  const pontosDeAtencao = gerencial.lojas.slice(0, 5);
  const destacar = new Set(gerencial.lojas.length > 5 ? pontosDeAtencao.map((l) => l.unidade) : []);
  const textoPercentual = (v: number | null) => (v === null ? "—" : `${formatadorPercentual.format(v)}%`);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-ragga-blue-dark">
        CONFERÊNCIA DE CAIXAS | {formatadorData.format(dados.periodoInicio)} a {formatadorData.format(dados.periodoFim)}
      </h2>

      {/* 1) Visão gerencial do período: previstos × conferidos × pendentes */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigNumberCard titulo="Caixas previstos" valor={String(gerencial.rede.previstos)} />
        <BigNumberCard titulo="Caixas conferidos" valor={String(gerencial.rede.conferidos)} />
        <BigNumberCard titulo="Caixas pendentes" valor={String(gerencial.rede.pendentes)} alerta={gerencial.rede.pendentes > 0} />
        <BigNumberCard titulo="% de conferência" valor={textoPercentual(gerencial.rede.percentual)} />
      </div>
      <p className="text-[11px] text-foreground/45">
        Soma dos dias do período com lançamento (caixas cadastrados × conferidos por loja e dia). Pendentes = previstos − conferidos; conferido acima do cadastrado
        não compensa pendência de outro dia. Dias ainda sem lançamento e a MAPOLI aos sábados e domingos não são previstos
        {gerencial.registrosMapoliFimDeSemana > 0 ? ` (${gerencial.registrosMapoliFimDeSemana} registros)` : ""}.
        {gerencial.registrosComExcedente > 0
          ? ` ${gerencial.registrosComExcedente} registros têm conferido maior que o cadastrado (+${gerencial.unidadesExcedente}); contados só até o cadastrado.`
          : ""}
      </p>

      <Secao titulo="Principais pontos de atenção">
        {pontosDeAtencao.length === 0 ? (
          <p className="text-sm text-foreground/45">Sem caixas previstos no período.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {pontosDeAtencao.map((l, i) => (
              <li key={l.unidade} className="rounded-lg border border-semaforo-vermelho/20 bg-semaforo-vermelho/5 px-3 py-2">
                <p className="text-xs text-foreground/50">{i + 1}º menor % de conferência</p>
                <p className="text-base font-bold text-ragga-blue-dark">{l.unidade}</p>
                <p className="text-sm font-semibold tabular-nums text-semaforo-vermelho">{textoPercentual(l.percentual)}</p>
                <p className="text-xs text-foreground/60">
                  {l.pendentes} {l.pendentes === 1 ? "pendente" : "pendentes"} de {l.previstos} previstos
                </p>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Lojas com menor % de conferência">
        {gerencial.lojas.length === 0 ? (
          <p className="text-sm text-foreground/45">Sem caixas previstos no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-2 pr-4">Ranking</th>
                  <th className="px-3 py-2">Loja</th>
                  <th className="px-3 py-2">Caixas previstos</th>
                  <th className="px-3 py-2">Caixas conferidos</th>
                  <th className="px-3 py-2">Caixas pendentes</th>
                  <th className="px-3 py-2">% de conferência</th>
                </tr>
              </thead>
              <tbody>
                {gerencial.lojas.map((l, i) => (
                  <tr key={l.unidade} className={`border-b border-ragga-blue/5 ${destacar.has(l.unidade) ? "bg-semaforo-vermelho/5" : ""}`}>
                    <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                    <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                    <td className="px-3">{l.previstos}</td>
                    <td className="px-3">{l.conferidos}</td>
                    <td className={`px-3 ${l.pendentes > 0 ? "font-semibold text-semaforo-vermelho" : ""}`}>{l.pendentes}</td>
                    <td className={`px-3 font-semibold ${destacar.has(l.unidade) ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{textoPercentual(l.percentual)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                  <td className="py-2.5 pr-4" colSpan={2}>REDE</td>
                  <td className="px-3">{gerencial.rede.previstos}</td>
                  <td className="px-3">{gerencial.rede.conferidos}</td>
                  <td className="px-3">{gerencial.rede.pendentes}</td>
                  <td className="px-3">{textoPercentual(gerencial.rede.percentual)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-foreground/40">
          Ordenado da menor % de conferência para a maior; empate: mais caixas pendentes primeiro. As 5 lojas com menor % ficam destacadas (sem meta/limite novo).
        </p>
      </Secao>

      {/* 2) Posição mais recente (último dia com lançamento) e matriz operacional — inalteradas */}
      <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Posição do último dia com lançamento</p>
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
