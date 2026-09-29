"use client";

import { useState, useTransition } from "react";
import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { STATUS_OPCOES, paraInputDateOuVazio, dataDoInputOuNull } from "@/lib/services/planoAcao";
import type { TratativaLinha, FiltroTratativas, NovaTratativaInput, StatusExibicao } from "@/lib/services/planoAcao";
import { buscarTratativasPorFiltro } from "@/lib/actions/buscarTratativasPorFiltro";
import { criarTratativa } from "@/lib/actions/criarTratativa";
import { atualizarTratativa } from "@/lib/actions/atualizarTratativa";

const INDICADORES = ["Brindes", "Cancelamento Salão", "Cancelamento Delivery", "Retirada Compra Direta", "Troco", "PDV × Adquirente"];

const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function formatarData(data: Date | null): string {
  return data ? formatadorData.format(data) : "—";
}

function tomDoStatus(status: StatusExibicao): "ok" | "warn" | "alert" | "neutro" {
  if (status === "Concluído") return "ok";
  if (status === "Atrasado") return "alert";
  if (status === "Em andamento") return "warn";
  return "neutro";
}

const VAZIO_NOVA: NovaTratativaInput = {
  unidade: UNIDADES[0],
  indicador: INDICADORES[0],
  dataOcorrencia: null,
  problema: "",
  acao: "",
  responsavel: "",
  prazo: null,
};

/**
 * Plano de Ação — CRUD sobre `tratativas` (tabela já existente antes
 * desta etapa). Sem filtro de "Data de Referência" (a tabela não é
 * versionada por dia — `dataOcorrencia` é um campo livre por registro,
 * ver `analiseGerencial.server.ts`/`lib/services/planoAcao.ts`).
 */
export function PlanoAcaoView({ dadosIniciais, prefill }: { dadosIniciais: TratativaLinha[]; prefill?: Partial<NovaTratativaInput> | null }) {
  const [tratativas, setTratativas] = useState(dadosIniciais);
  const [filtro, setFiltro] = useState<FiltroTratativas>({});
  const [formAberto, setFormAberto] = useState(Boolean(prefill));
  const [novaTratativa, setNovaTratativa] = useState<NovaTratativaInput>({ ...VAZIO_NOVA, ...prefill });
  const [pendente, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function recarregar(novoFiltro: FiltroTratativas) {
    setFiltro(novoFiltro);
    iniciarTransicao(async () => {
      const resultado = await buscarTratativasPorFiltro(novoFiltro);
      setTratativas(resultado);
    });
  }

  async function salvarNovaTratativa() {
    setErro(null);
    if (!novaTratativa.problema.trim() || !novaTratativa.acao.trim() || !novaTratativa.responsavel.trim()) {
      setErro("Problema, ação e responsável são obrigatórios.");
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await criarTratativa(novaTratativa);
      if (!resultado) {
        setErro("Banco de dados não conectado — não foi possível salvar.");
        return;
      }
      setNovaTratativa(VAZIO_NOVA);
      setFormAberto(false);
      const atualizado = await buscarTratativasPorFiltro(filtro);
      setTratativas(atualizado);
    });
  }

  function alterarCampoLista(id: string, campo: "status" | "responsavel" | "prazo", valor: string) {
    iniciarTransicao(async () => {
      if (campo === "status") await atualizarTratativa({ id, status: valor });
      else if (campo === "responsavel") await atualizarTratativa({ id, responsavel: valor });
      else if (campo === "prazo") await atualizarTratativa({ id, prazo: dataDoInputOuNull(valor) });
      const atualizado = await buscarTratativasPorFiltro(filtro);
      setTratativas(atualizado);
    });
  }

  return (
    <div className="flex-1 space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <div>
          <label className="block text-xs font-medium text-foreground/60">Loja</label>
          <select
            className="mt-1 rounded border border-ragga-blue/20 bg-white px-2 py-1 text-sm"
            value={filtro.unidade ?? ""}
            onChange={(e) => recarregar({ ...filtro, unidade: (e.target.value || undefined) as CodigoUnidade | undefined })}
          >
            <option value="">Todas</option>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/60">Indicador</label>
          <select
            className="mt-1 rounded border border-ragga-blue/20 bg-white px-2 py-1 text-sm"
            value={filtro.indicador ?? ""}
            onChange={(e) => recarregar({ ...filtro, indicador: e.target.value || undefined })}
          >
            <option value="">Todos</option>
            {INDICADORES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/60">Status</label>
          <select
            className="mt-1 rounded border border-ragga-blue/20 bg-white px-2 py-1 text-sm"
            value={filtro.status ?? ""}
            onChange={(e) => recarregar({ ...filtro, status: e.target.value || undefined })}
          >
            <option value="">Todos</option>
            {STATUS_OPCOES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setFormAberto((v) => !v)}
          className="ml-auto rounded bg-ragga-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-ragga-blue-dark"
        >
          {formAberto ? "Cancelar" : "+ Nova tratativa"}
        </button>
      </div>

      {formAberto && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ragga-blue-dark">Nova tratativa</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-foreground/60">Loja</label>
              <select
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={novaTratativa.unidade}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, unidade: e.target.value as CodigoUnidade }))}
              >
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60">Indicador</label>
              <select
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={novaTratativa.indicador}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, indicador: e.target.value }))}
              >
                {INDICADORES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60">Data da ocorrência</label>
              <input
                type="date"
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={paraInputDateOuVazio(novaTratativa.dataOcorrencia)}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, dataOcorrencia: dataDoInputOuNull(e.target.value) }))}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-foreground/60">Problema (motivo)</label>
              <input
                type="text"
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={novaTratativa.problema}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, problema: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-foreground/60">Ação (orientação)</label>
              <textarea
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                rows={2}
                value={novaTratativa.acao}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, acao: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60">Responsável</label>
              <input
                type="text"
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={novaTratativa.responsavel}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, responsavel: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/60">Prazo</label>
              <input
                type="date"
                className="mt-1 w-full rounded border border-ragga-blue/20 px-2 py-1 text-sm"
                value={paraInputDateOuVazio(novaTratativa.prazo)}
                onChange={(e) => setNovaTratativa((f) => ({ ...f, prazo: dataDoInputOuNull(e.target.value) }))}
              />
            </div>
          </div>
          {erro && <p className="mt-2 text-xs text-semaforo-vermelho">{erro}</p>}
          <button
            type="button"
            disabled={pendente}
            onClick={salvarNovaTratativa}
            className="mt-3 rounded bg-ragga-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-ragga-blue-dark disabled:opacity-50"
          >
            Salvar tratativa
          </button>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">Indicador</th>
              <th className="px-4 py-2">Problema</th>
              <th className="px-4 py-2">Ação</th>
              <th className="px-4 py-2">Responsável</th>
              <th className="px-4 py-2">Prazo</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {tratativas.length === 0 ? (
              <EstadoVazio colSpan={7} texto="Nenhuma tratativa cadastrada para este filtro." />
            ) : (
              tratativas.map((t) => (
                <tr key={t.id} className="border-b border-ragga-blue/5 align-top last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{t.unidade}</td>
                  <td className="px-4 py-2">{t.indicador}</td>
                  <td className="px-4 py-2 max-w-xs">
                    {t.problema}
                    {t.dataOcorrencia && <div className="text-xs text-foreground/40">Ocorrência: {formatarData(t.dataOcorrencia)}</div>}
                  </td>
                  <td className="px-4 py-2 max-w-sm text-foreground/60">{t.acao}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      defaultValue={t.responsavel}
                      onBlur={(e) => e.target.value !== t.responsavel && alterarCampoLista(t.id, "responsavel", e.target.value)}
                      className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-ragga-blue/20 focus:border-ragga-blue/40"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="date"
                      defaultValue={paraInputDateOuVazio(t.prazo)}
                      onChange={(e) => alterarCampoLista(t.id, "prazo", e.target.value)}
                      className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-ragga-blue/20 focus:border-ragga-blue/40"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={STATUS_OPCOES.includes(t.status as (typeof STATUS_OPCOES)[number]) ? t.status : STATUS_OPCOES[0]}
                      onChange={(e) => alterarCampoLista(t.id, "status", e.target.value)}
                      className="rounded border border-ragga-blue/10 bg-transparent px-1 py-0.5 text-xs"
                    >
                      {STATUS_OPCOES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1">
                      <StatusBadge tom={tomDoStatus(t.statusExibicao)} texto={t.statusExibicao} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
