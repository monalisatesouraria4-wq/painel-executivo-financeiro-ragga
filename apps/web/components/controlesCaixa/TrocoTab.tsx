"use client";

import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/**
 * Sub-aba Troco (`renderTroco`, linha 3537 do legado). Conferência
 * semanal, resolvida por `semanaRealDoPeriodo` (reaproveitada tal como
 * já validada — nenhuma regra nova). Status por linha (`statusTroco`,
 * linha 3477, já existente): sem registro → "Conferência não
 * realizada" (âmbar, hoje nunca produzida pelo service — mantido só
 * para não remover um estado já previsto); diferenca===0 → "Conferido"
 * (verde); senão → "Divergência" (vermelho). Nenhum novo limiar/regra de
 * divergência foi criado aqui — a classificação continua vindo de
 * `diferenca === 0`, calculada em lib/services/controlesCaixa.ts.
 *
 * Chave mantida exatamente como já validada e documentada:
 * unidade_id + data + caixa — não alterada aqui.
 */
const TOM_POR_STATUS: Record<string, "ok" | "warn" | "alert"> = {
  "Conferido": "ok",
  "Divergência": "alert",
  "Conferência não realizada": "warn",
};

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// timeZone: "UTC" — datas desta base são "puras" (meia-noite UTC, sem
// hora real, ver parseDataCelula); sem fixar o fuso, o navegador pode
// exibir o dia anterior dependendo do fuso local do cliente (mesmo
// padrão já aplicado em ConferenciaTab.tsx).
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

export function TrocoTab({ dados }: { dados: ControlesCaixaData["troco"] }) {
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  function alternar(unidade: string) {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(unidade)) proximo.delete(unidade);
      else proximo.add(unidade);
      return proximo;
    });
  }

  const todasCaixas = useMemo(() => dados.linhas.flatMap((l) => l.caixas), [dados.linhas]);
  const conferidos = todasCaixas.filter((c) => c.status === "Conferido").length;
  const comDivergencia = todasCaixas.filter((c) => c.status === "Divergência").length;
  const valorTotalDivergencias = todasCaixas
    .filter((c) => c.status === "Divergência")
    .reduce((s, c) => s + Math.abs(c.diferenca), 0);
  const percentualDivergencia = todasCaixas.length > 0 ? (comDivergencia / todasCaixas.length) * 100 : 0;

  const periodo =
    todasCaixas.length > 0
      ? (() => {
          const datas = todasCaixas.map((c) => c.data.getTime());
          return { inicio: new Date(Math.min(...datas)), fim: new Date(Math.max(...datas)) };
        })()
      : null;

  return (
    <div className="space-y-4">
      {periodo && (
        <p className="text-xs text-foreground/50">
          {periodo.inicio.getTime() === periodo.fim.getTime()
            ? `Data do registro: ${formatadorData.format(periodo.inicio)}`
            : `Semana com dado: ${formatadorData.format(periodo.inicio)} a ${formatadorData.format(periodo.fim)}`}
        </p>
      )}

      {!dados.disponivel ? (
        <p className="text-sm text-foreground/50">Sem dados para o período</p>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Caixas conferidos</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{conferidos}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Caixas com divergência</p>
              <p className="mt-1 text-2xl font-semibold text-semaforo-vermelho">{comDivergencia}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Valor total das divergências</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(valorTotalDivergencias)}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">% de caixas com divergência</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorPercentual.format(percentualDivergencia)}%</p>
            </Card>
          </div>

          {/* Tabela principal por loja */}
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                  <th className="px-4 py-2">Loja</th>
                  <th className="px-4 py-2">Qtd. caixas</th>
                  <th className="px-4 py-2">Conferidos</th>
                  <th className="px-4 py-2">Com divergência</th>
                  <th className="px-4 py-2">Valor total da divergência</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {dados.linhas.length === 0 ? (
                  <EstadoVazio colSpan={6} />
                ) : (
                  dados.linhas.map((linha) => {
                    const conferidosLoja = linha.caixas.filter((c) => c.status === "Conferido").length;
                    const divergentesLoja = linha.caixas.filter((c) => c.status === "Divergência");
                    const valorDivergenciaLoja = divergentesLoja.reduce((s, c) => s + Math.abs(c.diferenca), 0);
                    const statusLoja = divergentesLoja.length > 0 ? "Divergência" : "Conferido";
                    return (
                      <Fragment key={linha.unidade}>
                        <tr
                          onClick={() => alternar(linha.unidade)}
                          className="cursor-pointer border-b border-ragga-blue/5 last:border-0 hover:bg-ragga-bg"
                        >
                          <td className="px-4 py-2 font-medium text-ragga-blue-dark">
                            {expandidas.has(linha.unidade) ? "▾" : "▸"} {linha.unidade}
                          </td>
                          <td className="px-4 py-2">{linha.caixas.length}</td>
                          <td className="px-4 py-2">{conferidosLoja}</td>
                          <td className="px-4 py-2">{divergentesLoja.length}</td>
                          <td className="px-4 py-2">{formatadorMoeda.format(valorDivergenciaLoja)}</td>
                          <td className="px-4 py-2">
                            <StatusBadge tom={TOM_POR_STATUS[statusLoja]} texto={statusLoja} />
                          </td>
                        </tr>
                        {expandidas.has(linha.unidade) && (
                          <tr>
                            <td colSpan={6} className="bg-ragga-bg/50 px-4 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left uppercase tracking-wide text-foreground/50">
                                    <th className="px-2 py-1">Caixa</th>
                                    <th className="px-2 py-1">Data</th>
                                    <th className="px-2 py-1">Conferido</th>
                                    <th className="px-2 py-1">Informado</th>
                                    <th className="px-2 py-1">Diferença</th>
                                    <th className="px-2 py-1">Status</th>
                                    <th className="px-2 py-1">Operador</th>
                                    <th className="px-2 py-1">Plano de ação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {linha.caixas.map((caixa, i) => (
                                    <tr
                                      key={`${linha.unidade}-${caixa.caixa}-${i}`}
                                      className={
                                        caixa.status === "Divergência"
                                          ? "bg-semaforo-vermelho/10"
                                          : "border-b border-ragga-blue/5 last:border-0"
                                      }
                                    >
                                      <td className="px-2 py-1.5 font-medium">{caixa.caixa}</td>
                                      <td className="px-2 py-1.5">{formatadorData.format(caixa.data)}</td>
                                      <td className="px-2 py-1.5">{formatadorMoeda.format(caixa.conferido)}</td>
                                      <td className="px-2 py-1.5">{formatadorMoeda.format(caixa.informado)}</td>
                                      <td
                                        className={`px-2 py-1.5 ${
                                          caixa.status === "Divergência" ? "font-semibold text-semaforo-vermelho" : ""
                                        }`}
                                      >
                                        {formatadorMoeda.format(caixa.diferenca)}
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <StatusBadge tom={TOM_POR_STATUS[caixa.status]} texto={caixa.status} />
                                      </td>
                                      <td className="px-2 py-1.5">{caixa.operador ?? "—"}</td>
                                      <td className="px-2 py-1.5">{caixa.planoDeAcao ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
