"use client";

import { useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { buscarOrientacaoEntry } from "@/lib/services/analiseGerencial";
import { criarTratativa } from "@/lib/actions/criarTratativa";
import { dataDoInputOuNull } from "@/lib/services/planoAcao";
import type { NovaTratativaInput } from "@/lib/services/planoAcao";

/**
 * Célula "Plano de Ação" da tabela "Por unidade" (item 2 da etapa de
 * revisão — incorpora a parte útil da antiga Análise Gerencial direto em
 * Indicadores). Reaproveita 100% o que já existe:
 * - catálogo real de orientações (`buscarOrientacaoEntry`, mesmo usado
 *   pela extinta tela Análise Gerencial) — nenhuma orientação nova;
 * - `criarTratativa` + tabela `tratativas` já existentes (Plano de Ação) —
 *   nenhuma estrutura de banco nova.
 * Motivo sem entrada no catálogo mostra "Sem orientação cadastrada." —
 * nunca esconde a linha.
 */
export function PlanoAcaoCelula({
  indicador,
  unidade,
  motivo,
  valor,
  percentualFaturamento,
  dataOcorrencia,
}: {
  indicador: string;
  unidade: CodigoUnidade;
  motivo: string | null;
  valor: number;
  percentualFaturamento: number;
  dataOcorrencia: Date | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [responsavel, setResponsavel] = useState("");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!motivo) return <span className="text-xs text-foreground/30">—</span>;

  const entry = buscarOrientacaoEntry(indicador, motivo);
  const textoOrientacao = entry?.texto ?? "Sem orientação cadastrada.";
  const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function fechar() {
    setAberto(false);
    setFormAberto(false);
    setSalvo(false);
    setErro(null);
  }

  async function salvarTratativa() {
    if (!responsavel.trim()) {
      setErro("Informe o responsável.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const input: NovaTratativaInput = {
      unidade,
      indicador,
      dataOcorrencia,
      problema: motivo!,
      acao: textoOrientacao,
      responsavel: responsavel.trim(),
      prazo: dataDoInputOuNull(prazo),
    };
    const resultado = await criarTratativa(input);
    setSalvando(false);
    if (!resultado) {
      setErro("Banco de dados não conectado — não foi possível salvar.");
      return;
    }
    setSalvo(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="whitespace-nowrap text-xs font-medium text-ragga-blue-dark hover:underline"
      >
        Ver orientação →
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && fechar()}
        >
          <div className="w-full max-w-md rounded-lg bg-ragga-surface p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-ragga-blue-dark">
                {unidade} — {indicador}
              </h3>
              <button type="button" onClick={fechar} className="text-foreground/40 hover:text-foreground">
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground/50">Motivo</p>
            <p className="text-sm text-ragga-blue-dark">{motivo}</p>
            <p className="text-xs text-foreground/50">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor)} ·{" "}
              {formatadorPercentual.format(percentualFaturamento)}% do faturamento
            </p>

            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground/50">Orientação</p>
            <p className="text-sm text-foreground/70">📌 {textoOrientacao}</p>

            {!salvo && !formAberto && (
              <button
                type="button"
                onClick={() => setFormAberto(true)}
                className="mt-4 rounded bg-ragga-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-ragga-blue-dark"
              >
                Registrar tratativa
              </button>
            )}

            {!salvo && formAberto && (
              <div className="mt-4 space-y-2 border-t border-ragga-blue/10 pt-3">
                <div>
                  <label className="block text-xs font-medium text-foreground/60">Responsável</label>
                  <input
                    type="text"
                    value={responsavel}
                    onChange={(e) => setResponsavel(e.target.value)}
                    className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/60">Prazo</label>
                  <input
                    type="date"
                    value={prazo}
                    onChange={(e) => setPrazo(e.target.value)}
                    className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                  />
                </div>
                <p className="text-xs text-foreground/50">Status inicial: Aberto</p>
                {erro && <p className="text-xs text-semaforo-vermelho">{erro}</p>}
                <button
                  type="button"
                  disabled={salvando}
                  onClick={salvarTratativa}
                  className="rounded bg-ragga-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-ragga-blue-dark disabled:opacity-50"
                >
                  {salvando ? "Salvando..." : "Salvar tratativa"}
                </button>
              </div>
            )}

            {salvo && <p className="mt-4 text-sm text-semaforo-verde">✓ Tratativa registrada com sucesso.</p>}
          </div>
        </div>
      )}
    </>
  );
}
