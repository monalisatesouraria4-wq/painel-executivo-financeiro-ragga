"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import type {
  ModoRetiradaDeposito,
  RetiradaDepositoDiaData,
  RetiradaDepositoPersonalizadoData,
} from "@/lib/services/retiradaDeposito";
import { buscarRetiradaDepositoPersonalizado } from "@/lib/actions/buscarRetiradaDepositoPersonalizado";

// `dataReferenciaD1` é derivada de "agora" (hora real, não meia-noite
// UTC) — mantém o fuso local do host de propósito, para exibir o dia
// calendário correto de "ontem". Já `maxDataDisponivel` vem direto do
// banco como data "pura" (meia-noite UTC) — precisa de `timeZone: "UTC"`
// (mesmo padrão de ConferenciaTab.tsx) para não exibir um dia antes.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const formatadorDataBanco = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Reproduz `renderRetirada`/`renderRetiradaPersonalizado` (legado,
 * linhas 2151-2296). Título interno "Retirada para depósito" (h2, texto
 * do legado), rótulo do menu "Retirada para Depósito" (mantido no
 * sidebar/nav de Retiradas, não repetido aqui).
 */
export function RetiradaDepositoTab({ dadosDia }: { dadosDia: RetiradaDepositoDiaData }) {
  const [modo, setModo] = useState<ModoRetiradaDeposito>("dia");
  const [dadosPersonalizado, setDadosPersonalizado] = useState<RetiradaDepositoPersonalizadoData | null>(null);
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");

  useEffect(() => {
    if (modo !== "personalizado" || !dataInicial || !dataFinal) return;
    buscarRetiradaDepositoPersonalizado(new Date(dataInicial), new Date(dataFinal)).then(setDadosPersonalizado);
  }, [modo, dataInicial, dataFinal]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ragga-blue-dark">Retirada para depósito</h2>
      </div>

      {/* Toggle Dia/Personalizado — nomes exatos do legado */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border border-ragga-blue/15 p-1">
          {(["dia", "personalizado"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                modo === m ? "bg-ragga-blue text-white" : "text-foreground/60 hover:bg-ragga-bg"
              }`}
            >
              {m === "dia" ? "Dia" : "Personalizado"}
            </button>
          ))}
        </div>

        {modo === "personalizado" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dataInicial}
              onChange={(e) => setDataInicial(e.target.value)}
              className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-foreground/50">até</span>
            <input
              type="date"
              value={dataFinal}
              onChange={(e) => setDataFinal(e.target.value)}
              className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {modo === "dia" ? (
        <DiaConteudo dados={dadosDia} />
      ) : (
        <PersonalizadoConteudo dados={dadosPersonalizado} temDatas={Boolean(dataInicial && dataFinal)} />
      )}
    </div>
  );
}

function DiaConteudo({ dados }: { dados: RetiradaDepositoDiaData }) {
  return (
    <div className="space-y-3">
      {!dados.conectado && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Esta base ainda não tem dados para <b>{formatadorData.format(dados.dataReferenciaD1)}</b> (D-1) —
          banco de dados não conectado. Nenhum valor foi inventado.
        </div>
      )}
      {dados.conectado && dados.banner === "base_vazia" && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Nenhuma retirada registrada nesta base ainda.
        </div>
      )}
      {dados.conectado && dados.banner === "sem_dado" && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Esta base ainda não tem dados para <b>{formatadorData.format(dados.dataReferenciaD1)}</b> (D-1)
          {dados.maxDataDisponivel && (
            <> — última data disponível: <b>{formatadorDataBanco.format(dados.maxDataDisponivel)}</b>.</>
          )}
        </div>
      )}
      {dados.conectado && dados.banner === "parcial" && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          🟡 <b>Dado parcial:</b> {formatadorData.format(dados.dataReferenciaD1)} (D-1) é a data mais recente
          desta base — pode ainda não estar completo.
        </div>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Filial</th>
              <th className="px-4 py-2">Retirada do dia (D-1)</th>
              <th className="px-4 py-2">Acumulado do ciclo</th>
              <th className="px-4 py-2">Ciclo</th>
            </tr>
          </thead>
          <tbody>
            {dados.linhas.length === 0 ? (
              <EstadoVazio colSpan={4} />
            ) : (
              dados.linhas.map((linha) => (
                <tr key={linha.unidade} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.retiradaDia)}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.acumuladoCiclo)}</td>
                  <td className="px-4 py-2 text-foreground/60">{linha.cicloLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PersonalizadoConteudo({
  dados,
  temDatas,
}: {
  dados: RetiradaDepositoPersonalizadoData | null;
  temDatas: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground/50">
        Cada ciclo é somado por inteiro e mostrado em uma linha separada — valores de ciclos
        diferentes nunca são somados juntos.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Filial</th>
              <th className="px-4 py-2">Ciclo</th>
              <th className="px-4 py-2">Retirada no ciclo</th>
              <th className="px-4 py-2">Depósito esperado</th>
            </tr>
          </thead>
          <tbody>
            {!temDatas ? (
              <EstadoVazio colSpan={4} texto="Selecione a data inicial e a data final." />
            ) : !dados || dados.linhas.length === 0 ? (
              <EstadoVazio colSpan={4} />
            ) : (
              dados.linhas.map((linha, i) => (
                <tr key={`${linha.unidade}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{linha.cicloLabel}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.retiradaCiclo)}</td>
                  <td className="px-4 py-2 text-foreground/60">{linha.depositoEsperadoLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
