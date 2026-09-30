"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { IndicadorCard } from "@/components/ui/IndicadorCard";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { VisaoGeralData, IndicadorComSemaforo } from "@/lib/services/visaoGeral";
import { buscarVisaoGeralPorData } from "@/lib/actions/buscarVisaoGeralPorData";

const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
// timeZone: "UTC" — `dataRegistro` vem do banco como data "pura" (meia-noite UTC); sem fixar
// o fuso aqui o navegador poderia exibir o dia anterior dependendo do fuso local do cliente
// (mesmo cuidado já aplicado em outras telas, ex.: ConferenciaTab.tsx).
const formatadorDataRegistro = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Mesmo mapeamento cor→texto já usado em `IndicadorCard.tsx` — não é um rótulo novo. */
const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

/**
 * Célula de indicador percentual + semáforo para "Detalhamento por loja".
 * Usa exatamente o `percentualFaturamento`/`semaforo` já calculados em
 * `visaoGeral.ts` (mesmas faixas de `lib/rules/semaforos.ts` dos cards do
 * topo) — nenhum threshold novo. Sem denominador: "—", sem badge.
 */
function CelulaIndicadorLoja({ indicador }: { indicador: IndicadorComSemaforo }) {
  if (!indicador.disponivel || indicador.percentualFaturamento === undefined) {
    return <span className="text-foreground/40">—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span>{formatadorPercentual.format(indicador.percentualFaturamento)}%</span>
      {indicador.semaforo && <SemaforoBadge cor={indicador.semaforo} texto={TEXTO_SEMAFORO[indicador.semaforo]} />}
    </div>
  );
}

/**
 * Corpo da Visão Geral, extraído para Client Component para ganhar o
 * filtro de "Data de referência" (sempre visível). Nenhuma regra de
 * negócio muda: a data escolhida só alimenta `buscarVisaoGeral`, que
 * continua aplicando D-1 exatamente como antes.
 */
export function VisaoGeralView({ dadosIniciais, dataInicial }: { dadosIniciais: VisaoGeralData; dataInicial: Date }) {
  const [dados, setDados] = useState(dadosIniciais);
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(dataInicial));
  const [pendente, iniciarTransicao] = useTransition();

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const resultado = await buscarVisaoGeralPorData(dataDoInput(novaData));
      setDados(resultado);
    });
  }

  const indicadoresComAlerta = [
    { titulo: "Brindes", dados: dados.brindes },
    { titulo: "Cancelamento Salão", dados: dados.cancelamentoSalao },
    { titulo: "Cancelamento Delivery", dados: dados.cancelamentoDelivery },
    { titulo: "Retirada Compra Direta", dados: dados.retiradaCompraDireta },
  ].filter((i) => i.dados.disponivel && (i.dados.semaforo === "vermelho" || i.dados.semaforo === "amarelo"));

  return (
    <main className="flex-1 space-y-6 px-6 py-6">
      <div className="rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). Os
          indicadores abaixo ficam pendentes até a carga de dados reais ser autorizada —
          nenhum valor foi inventado.
        </div>
      )}

      {/* Hero — Faturamento (div dedicada: o componente Card fixa bg-ragga-surface,
          que colidia com a classe de fundo azul passada via className) */}
      <div className="rounded-lg bg-ragga-blue p-6 text-white shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">
          Faturamento do dia (D-1 de {formatadorData.format(dados.dataReferencia)})
        </p>
        {dados.faturamento.disponivel ? (
          <>
            <p className="mt-1 text-4xl font-bold">{formatadorMoeda.format(dados.faturamento.valor ?? 0)}</p>
            {dados.faturamento.ultimoRegistroDisponivel && dados.faturamento.dataRegistro && (
              <p className="mt-1 text-xs text-white/70">Último registro: {formatadorDataRegistro.format(dados.faturamento.dataRegistro)}</p>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-4xl font-bold text-white/40">—</p>
            <p className="mt-1 text-xs text-white/70">{dados.conectado ? "Sem dados disponíveis" : "Sem dados para esta referência"}</p>
          </>
        )}
      </div>

      {/* Alertas / divergências */}
      {indicadoresComAlerta.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">⚠️ Alertas</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {indicadoresComAlerta.map((item) => (
              <div
                key={item.titulo}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                  item.dados.semaforo === "vermelho"
                    ? "border-semaforo-vermelho/30 bg-semaforo-vermelho/10"
                    : "border-semaforo-amarelo/30 bg-semaforo-amarelo/10"
                }`}
              >
                <span className="font-medium text-ragga-blue-dark">{item.titulo}</span>
                <span className={item.dados.semaforo === "vermelho" ? "text-semaforo-vermelho" : "text-semaforo-amarelo"}>
                  {formatadorPercentual.format(item.dados.percentualFaturamento ?? 0)}% do faturamento
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Formas de Pagamento */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Formas de Pagamento (D-1)</h2>
        {dados.formasPagamento.disponivel && dados.formasPagamento.buckets ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["Crédito", dados.formasPagamento.buckets.credito],
                ["Débito", dados.formasPagamento.buckets.debito],
                ["PIX", dados.formasPagamento.buckets.pix],
                ["Voucher", dados.formasPagamento.buckets.voucher],
                ["Venda a Prazo", dados.formasPagamento.buckets.vendaAPrazo],
                ["Online", dados.formasPagamento.buckets.online],
                ["Dinheiro", dados.formasPagamento.buckets.dinheiro],
              ] as const
            ).map(([label, valor]) => (
              <Card key={label}>
                <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</p>
                <p className="mt-1 text-sm font-semibold text-ragga-blue-dark">{formatadorMoeda.format(valor)}</p>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground/50">Sem dados para esta referência</p>
        )}
      </section>

      {/* Indicadores */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Indicadores</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IndicadorCard titulo="Brindes" {...dados.brindes} observacao={dados.conectado ? "Sem dados disponíveis" : undefined} />
          <IndicadorCard
            titulo="Cancelamento Salão"
            {...dados.cancelamentoSalao}
            observacao={dados.conectado ? "Sem dados disponíveis" : undefined}
          />
          <IndicadorCard
            titulo="Cancelamento Delivery"
            {...dados.cancelamentoDelivery}
            observacao={dados.conectado ? "Sem dados disponíveis" : undefined}
          />
        </div>
      </section>

      {/* Retiradas */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Retiradas</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <IndicadorCard
            titulo="Retirada Compra Direta"
            {...dados.retiradaCompraDireta}
            observacao={dados.conectado ? "Sem dados disponíveis" : undefined}
          />
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
              Retirada p/ Depósito
            </p>
            {dados.retiradaDeposito.disponivel ? (
              <>
                <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
                  {formatadorMoeda.format(dados.retiradaDeposito.valorDia ?? 0)}
                </p>
                {dados.retiradaDeposito.dataRegistro && (
                  <p className="mt-1 text-xs text-foreground/50">
                    {dados.retiradaDeposito.ultimoRegistroDisponivel
                      ? `Último registro: ${formatadorDataRegistro.format(dados.retiradaDeposito.dataRegistro)}`
                      : formatadorDataRegistro.format(dados.retiradaDeposito.dataRegistro)}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">
                  {dados.conectado ? "Sem dados disponíveis" : "Sem dados para esta referência"}
                </p>
              </>
            )}
          </Card>
        </div>
      </section>

      {/* Controles de Caixa */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ragga-blue-dark">Controles de Caixa</h2>
          <Link href="/controles-caixa" className="text-xs font-medium text-ragga-blue hover:underline">
            Ver detalhes →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Fechamento</p>
            {dados.fechamento.disponivel ? (
              <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">
                {dados.fechamento.caixasAbertos} caixa(s) em aberto
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">Sem dados</p>
              </>
            )}
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">PDV × Maquininha</p>
            {dados.pdvMaquininha.disponivel ? (
              <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(dados.pdvMaquininha.diferenca ?? 0)}
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">Sem dados</p>
              </>
            )}
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Troco</p>
            {dados.troco.disponivel ? (
              <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">
                {dados.troco.divergencias} divergência(s)
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">Sem dados</p>
              </>
            )}
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Conferência</p>
            {dados.conferencia.disponivel ? (
              <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">
                {formatadorPercentual.format(dados.conferencia.percentualConferido ?? 0)}% conferido
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">Sem dados</p>
              </>
            )}
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Quebra de Caixa</p>
            {dados.quebraCaixa.disponivel ? (
              <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(dados.quebraCaixa.total ?? 0)}
              </p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold text-foreground/30">—</p>
                <p className="mt-2 text-xs text-foreground/50">Sem dados</p>
              </>
            )}
          </Card>
        </div>
      </section>

      {/* Detalhamento por loja */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Detalhamento por loja</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Loja</th>
                <th className="px-4 py-2">Faturamento</th>
                <th className="px-4 py-2">Retirada Compra Direta</th>
                <th className="px-4 py-2">Brindes</th>
                <th className="px-4 py-2">Cancel. Salão</th>
                <th className="px-4 py-2">Cancel. Delivery</th>
              </tr>
            </thead>
            <tbody>
              {dados.detalhamentoPorLoja.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-foreground/50">
                    Sem dados para esta referência.
                  </td>
                </tr>
              ) : (
                dados.detalhamentoPorLoja.map((linha) => (
                  <tr key={linha.unidade} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                    <td className="px-4 py-2">
                      {linha.faturamento.valor !== undefined ? formatadorMoeda.format(linha.faturamento.valor) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {linha.retiradaCompraDireta.valor !== undefined
                        ? formatadorMoeda.format(linha.retiradaCompraDireta.valor)
                        : "—"}
                      <div className="mt-0.5 text-xs">
                        <CelulaIndicadorLoja indicador={linha.retiradaCompraDireta} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {linha.brindes.valor !== undefined ? formatadorMoeda.format(linha.brindes.valor) : "—"}
                      <div className="mt-0.5 text-xs">
                        <CelulaIndicadorLoja indicador={linha.brindes} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {linha.cancelamentoSalao.valor !== undefined
                        ? formatadorMoeda.format(linha.cancelamentoSalao.valor)
                        : "—"}
                      <div className="mt-0.5 text-xs">
                        <CelulaIndicadorLoja indicador={linha.cancelamentoSalao} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {linha.cancelamentoDelivery.valor !== undefined
                        ? formatadorMoeda.format(linha.cancelamentoDelivery.valor)
                        : "—"}
                      <div className="mt-0.5 text-xs">
                        <CelulaIndicadorLoja indicador={linha.cancelamentoDelivery} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </main>
  );
}
