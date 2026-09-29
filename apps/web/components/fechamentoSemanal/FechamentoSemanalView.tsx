"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import type { FechamentoSemanalData } from "@/lib/services/fechamentoSemanal";
import { buscarFechamentoSemanalPorData } from "@/lib/actions/buscarFechamentoSemanalPorData";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Reproduz `renderSemanal`/`initSemanalControls` (legado, linhas
 * 4483-4557): 5 KPIs ao vivo (Faturamento do período / Brindes /
 * Cancelamentos (Delivery+Salão) / Retirada Compra Direta / Quebra de
 * caixa). PDV × Maquininha, Troco, Conferência e Fechamento dos caixas
 * são calculados no service mas só aparecem na imagem gerada no legado —
 * sem equivalente de geração de imagem implementado nesta etapa.
 *
 * Data de referência (filtro padronizado): resolve a semana real
 * correspondente via `semanaRealDoPeriodo` (mesma regra do Troco).
 */
export function FechamentoSemanalView({ dadosIniciais }: { dadosIniciais: FechamentoSemanalData }) {
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(new Date()));
  const [dados, setDados] = useState<FechamentoSemanalData>(dadosIniciais);
  const [pendente, iniciarTransicao] = useTransition();

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const resultado = await buscarFechamentoSemanalPorData(dataDoInput(novaData));
      setDados(resultado);
    });
  }

  const report = dados.report;

  return (
    <main className="flex-1 space-y-4 px-6 py-6">
      <div>
        <h2 className="text-lg font-semibold text-ragga-blue-dark">Fechamento Semanal</h2>
        <p className="text-sm text-foreground/60">
          · relatório consolidado do Grupo Londrino{dados.periodoLabel ? ` · ${dados.periodoLabel}` : ""}
        </p>
      </div>

      <div className="rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). O
          relatório fica pendente até a carga de dados reais ser autorizada — nenhum valor foi
          inventado.
        </div>
      )}

      {dados.conectado && !dados.disponivel && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Sem dados para esta referência.
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
                Faturamento do período
              </p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(report.faturamentoTotal)}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Brindes</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(report.brindeTotal)}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Cancelamentos (Delivery+Salão)</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(report.cancDeliveryTotal + report.cancSalaoTotal)}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Retirada Compra Direta</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(report.compraDiretaTotal)}
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Quebra de caixa</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
                {formatadorMoeda.format(report.quebraTotal)} · {report.quebraQtd} lançamento(s)
              </p>
            </Card>
          </div>

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
              Formas de pagamento
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>Crédito: {formatadorMoeda.format(report.formaBuckets.credito)}</div>
              <div>Débito: {formatadorMoeda.format(report.formaBuckets.debito)}</div>
              <div>PIX: {formatadorMoeda.format(report.formaBuckets.pix)}</div>
              <div>Voucher: {formatadorMoeda.format(report.formaBuckets.voucher)}</div>
              <div>Venda a Prazo: {formatadorMoeda.format(report.formaBuckets.vendaAPrazo)}</div>
              <div>Online: {formatadorMoeda.format(report.formaBuckets.online)}</div>
              <div>Dinheiro: {formatadorMoeda.format(report.formaBuckets.dinheiro)}</div>
              {report.formaBuckets.outros > 0.005 && <div>Outros: {formatadorMoeda.format(report.formaBuckets.outros)}</div>}
            </div>
          </Card>

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
              Imagem do fechamento semanal
            </p>
            <p className="mt-2 text-xs text-foreground/50">
              A imagem inclui também PDV × Maquininha, Troco, Conferência e Fechamento dos caixas
              (calculados no relatório, sem geração de imagem implementada nesta etapa).
            </p>
            <button
              type="button"
              disabled
              title="Geração de imagem ainda não implementada"
              className="mt-4 rounded-md bg-foreground/20 px-4 py-2 text-sm font-medium text-white cursor-not-allowed"
            >
              🖼️ Gerar imagem
            </button>
          </Card>
        </>
      )}
    </main>
  );
}
