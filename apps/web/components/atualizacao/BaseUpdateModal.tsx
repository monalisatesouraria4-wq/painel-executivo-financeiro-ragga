"use client";

import { useRef, useState } from "react";
import { processarArquivoBase, type BaseInfo, type ResultadoImportacao } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";
import { baseSnapshot, type BaseSnapshot } from "@/lib/import/basesSnapshot";
import { compactarLote } from "@/lib/import/loteCompacto";
import { formatarReais } from "@/lib/import/sincronizacao";
import {
  confirmarSincronizacaoBase,
  previsualizarSincronizacaoBase,
  type OpcoesUsuarioSincronizacao,
  type ResultadoConfirmacao,
  type ResultadoPrevia,
} from "@/lib/actions/sincronizacaoBases";
import { persistirDetalhesCancelamentoSalao } from "@/lib/actions/persistirCancelamentoSalaoDetalhes";

const formatadorHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
// timeZone: "UTC" — datas desta camada são "puras" (meia-noite UTC), mesmo padrão já usado em outras telas.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Erro legível: o limite de corpo das Server Actions (ver next.config.ts) ganha uma explicação em vez da mensagem técnica. */
function mensagemDeErro(e: unknown, padrao: string): string {
  const m = e instanceof Error ? e.message : "";
  if (/Body exceeded/i.test(m)) return "O lote deste arquivo é maior que o limite de envio da tela (4 MB). Nada foi gravado. Use o comando atualizar-bases ou um arquivo com período menor.";
  return m || padrao;
}

const GRAVIDADE_ROTULO: Record<string, string> = {
  "bloqueia-tudo": "BLOQUEIA TUDO",
  "bloqueia-exclusao": "bloqueia exclusão",
  "requer-confirmacao": "exige confirmação",
  aviso: "aviso",
};

/**
 * Modal de upload.
 *
 * Bases com SINCRONIZAÇÃO AUTORITATIVA (Faturamento, Brindes, Cancelamentos, Compra Direta e Retirada Depósito) NÃO gravam ao
 * selecionar o arquivo: o arquivo é validado pelo parser oficial, a prévia (somente leitura) é calculada no servidor e só a
 * confirmação explícita grava — pelo mesmo mecanismo do comando `atualizar-bases` (hash do plano, backup, transação
 * serializável, validação final e rollback). A tela apenas mostra o plano; as regras e os bloqueios vivem no servidor.
 * As demais bases mantêm o fluxo anterior.
 */
export function BaseUpdateModal({
  base,
  estadoAtual,
  onFechar,
  onSucesso,
}: {
  base: BaseInfo;
  estadoAtual: RegistroBase[];
  onFechar: () => void;
  onSucesso: (novoEstado: RegistroBase[]) => void;
}) {
  const [lendo, setLendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [horaAplicado, setHoraAplicado] = useState<string | null>(null);
  const [previa, setPrevia] = useState<ResultadoPrevia | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesUsuarioSincronizacao>({});
  const [textoExclusao, setTextoExclusao] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [desfecho, setDesfecho] = useState<ResultadoConfirmacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sincroniza = baseSnapshot(base.id);

  function limpar() {
    setResultado(null);
    setPrevia(null);
    setOpcoes({});
    setTextoExclusao("");
    setDesfecho(null);
    setErro(null);
    setHoraAplicado(null);
  }

  async function carregarPrevia(r: Extract<ResultadoImportacao, { status: "sucesso" }>, op: OpcoesUsuarioSincronizacao) {
    setErro(null);
    try {
      const p = await previsualizarSincronizacaoBase({ base: base.id, registros: compactarLote(base.id as BaseSnapshot, r.registrosSincronizacao!), opcoes: op, arquivoSha256: r.arquivoSha256 });
      setPrevia(p);
      if (!p.conectado) {
        // sem banco neste ambiente: comportamento anterior (atualização só da sessão do navegador)
        setHoraAplicado(formatadorHora.format(new Date()));
        onSucesso(r.novoEstado);
      }
    } catch (e) {
      setPrevia(null);
      setErro(mensagemDeErro(e, "Falha ao consultar a prévia da sincronização."));
    }
  }

  async function selecionarArquivo(file: File) {
    setLendo(true);
    limpar();
    try {
      const r = await processarArquivoBase(base.id, file, estadoAtual, new Date());
      setResultado(r);
      if (r.status !== "sucesso") return;
      if (sincroniza && r.registrosSincronizacao) {
        await carregarPrevia(r, {});
      } else {
        setHoraAplicado(formatadorHora.format(new Date()));
        onSucesso(r.novoEstado);
      }
    } finally {
      setLendo(false);
    }
  }

  async function alterarOpcao(nova: OpcoesUsuarioSincronizacao) {
    if (resultado?.status !== "sucesso") return;
    setOpcoes(nova);
    setTextoExclusao("");
    setLendo(true);
    try {
      await carregarPrevia(resultado, nova);
    } finally {
      setLendo(false);
    }
  }

  async function confirmar() {
    if (resultado?.status !== "sucesso" || !previa?.conectado) return;
    setConfirmando(true);
    setErro(null);
    try {
      const g = await confirmarSincronizacaoBase({
        base: base.id,
        registros: compactarLote(base.id as BaseSnapshot, resultado.registrosSincronizacao!),
        opcoes,
        arquivoSha256: resultado.arquivoSha256,
        hashPlanoAprovado: previa.plano.hashPlano,
        confirmacaoExclusao: textoExclusao,
      });
      setDesfecho(g);
      if (g.status !== "gravado") return;
      // Cancelamento Salão: detalhes individuais dos estornos (idempotente, em lotes) DEPOIS da sincronização confirmada
      if (resultado.detalhesParaGravar) {
        for (let i = 0; i < resultado.detalhesParaGravar.length; i += 800) {
          await persistirDetalhesCancelamentoSalao(resultado.detalhesParaGravar.slice(i, i + 800));
        }
      }
      setHoraAplicado(formatadorHora.format(new Date()));
      setResultado({ ...resultado, inseridos: g.inseridos, atualizados: g.atualizados, totalFinal: g.totalNoEscopoDepois.chaves, persistidoNoBanco: true });
      onSucesso(resultado.novoEstado);
    } catch (e) {
      setErro(mensagemDeErro(e, "Falha ao confirmar a sincronização."));
    } finally {
      setConfirmando(false);
    }
  }

  function fecharPorBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onFechar();
  }

  const gravado = desfecho?.status === "gravado";
  const plano = previa?.conectado ? previa.plano : null;
  const nExclusoes = plano?.idsParaRemover.length ?? 0;
  const exigeTexto = nExclusoes > 0;
  const textoCorreto = textoExclusao.trim() === `EXCLUIR ${nExclusoes}`;
  const exclusoesOk = !exigeTexto || (Boolean(previa?.conectado && previa.exclusoesHabilitadas && previa.backupDisponivel) && textoCorreto);
  const riscoConfirmavel = plano?.riscos.some((r) => r.codigo === "DIAS_SEM_MOVIMENTO" && r.gravidade === "requer-confirmacao");
  const exclusoesLiberadas = Boolean(previa?.conectado && previa.exclusoesHabilitadas && previa.backupDisponivel);
  const espelhara = Boolean(plano) && (plano!.removiveisTotal === 0 || (nExclusoes > 0 && exclusoesLiberadas));
  const sobraEfetiva = plano ? (espelhara ? 0 : plano.removiveisCentavos) : 0;
  const podeConfirmar = Boolean(plano?.podeGravar) && exclusoesOk && !confirmando && !gravado && !lendo;

  return (
    <div onClick={fecharPorBackdrop} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-lg bg-ragga-surface p-6 shadow-lg ${sincroniza ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-ragga-blue-dark">
            {base.icone} Atualizar base: {base.nome}
          </h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-md p-1 text-foreground/50 hover:bg-ragga-bg">
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-foreground/50">Arquivo esperado: {base.arquivoEsperado} (aceita .xlsx com nome equivalente)</p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) selecionarArquivo(file);
          }}
          className="mt-4 block w-full text-sm"
        />

        {lendo && <p className="mt-3 text-sm text-foreground/50">Lendo arquivo...</p>}

        {resultado?.status === "erro" && (
          <div className="mt-3 rounded-lg border border-semaforo-vermelho/30 bg-semaforo-vermelho/10 px-4 py-3 text-sm text-ragga-blue-dark">
            🔴 <b>Arquivo não aprovado.</b> {resultado.mensagem.replace("Arquivo não aprovado. ", "")}
          </div>
        )}

        {/* Bases sem sincronização autoritativa, ou ambiente sem banco: fluxo anterior */}
        {resultado?.status === "sucesso" && (!sincroniza || (previa && !previa.conectado)) && (
          <>
            <div className="mt-3 rounded-lg border border-semaforo-verde/30 bg-semaforo-verde/10 px-4 py-3 text-sm text-ragga-blue-dark">
              🟢 <b>Base atualizada com sucesso.</b>
              <div className="mt-1 text-xs text-foreground/70">
                Novos: {resultado.inseridos} · Atualizados: {resultado.atualizados} · Rejeitados: {resultado.rejeitados} · Total: {resultado.totalFinal}
                {horaAplicado && <> · Aplicado em: {horaAplicado}</>}
              </div>
              <div className="mt-1 text-xs text-foreground/70">
                Período encontrado no arquivo: {formatadorData.format(resultado.periodoArquivoInicio)} a {formatadorData.format(resultado.periodoArquivoFim)}
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-xs text-ragga-blue-dark">
              {resultado.persistidoNoBanco ? (
                <>💾 Gravado no banco de dados — os dados continuam disponíveis após recarregar a página.</>
              ) : (
                <>ℹ️ Válido apenas para esta sessão do navegador — recarregar a página restaura a base original.</>
              )}
            </div>
          </>
        )}

        {/* Sincronização autoritativa: prévia → revisão → confirmação */}
        {sincroniza && resultado?.status === "sucesso" && plano && (
          <section className="mt-4 space-y-3 text-xs text-ragga-blue-dark" aria-label="Prévia da sincronização">
            <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3">
              <h4 className="text-sm font-semibold">Prévia da sincronização (nada foi gravado ainda)</h4>
              {plano.escopo && (
                <p className="mt-1">
                  Escopo comprovado pelo arquivo: <b>{plano.escopo.unidades.length} loja(s)</b> de {dataBR(plano.escopo.inicio)} a {dataBR(plano.escopo.fim)}. O histórico fora desse escopo não é tocado.
                </p>
              )}
              <p className="mt-1">
                Fonte: {plano.fonte.chaves} chaves, <b>{formatarReais(plano.fonte.centavos)}</b> · Banco no escopo hoje: {plano.bancoNoEscopo.chaves} chaves, <b>{formatarReais(plano.bancoNoEscopo.centavos)}</b>
              </p>
              <p className="mt-1">
                Novos: <b data-testid="n-novos">{plano.novosTotal}</b> · Iguais: <b>{plano.iguais}</b> · Valor alterado: <b data-testid="n-alterados">{plano.alteradosTotal}</b> · Só no banco (candidatos a exclusão):{" "}
                <b data-testid="n-removiveis">{plano.removiveisTotal}</b> ({formatarReais(plano.removiveisCentavos)})
              </p>
              <p className="mt-1">Total do banco no escopo após aplicar: <b>{formatarReais(plano.totalFinalNoEscopoCentavos)}</b></p>
            </div>

            <div
              data-testid="espelho"
              className={`rounded-lg border px-4 py-3 font-semibold ${espelhara ? "border-semaforo-verde/30 bg-semaforo-verde/10" : "border-semaforo-vermelho/30 bg-semaforo-vermelho/10"}`}
            >
              {espelhara
                ? "✔ Depois de confirmar, o banco ficará IGUAL à planilha no escopo acima (totais iguais)."
                : `✖ Depois de confirmar, o banco NÃO ficará igual à planilha: sobrarão ${formatarReais(sobraEfetiva)} em registros que a planilha não tem${nExclusoes > 0 && !(previa?.conectado && previa.exclusoesHabilitadas && previa.backupDisponivel) ? " (exclusões bloqueadas neste ambiente)" : ""}.`}
            </div>

            {plano.riscos.length > 0 && (
              <ul className="space-y-1" aria-label="Riscos e bloqueios">
                {plano.riscos.map((r) => (
                  <li
                    key={r.codigo}
                    className={`rounded-md border px-3 py-2 ${r.gravidade === "aviso" ? "border-ragga-blue/15 bg-ragga-bg" : "border-semaforo-vermelho/30 bg-semaforo-vermelho/10"}`}
                  >
                    <b>{r.gravidade === "aviso" ? "ℹ️" : "⚠️"} {GRAVIDADE_ROTULO[r.gravidade] ?? r.gravidade} · {r.codigo}</b> — {r.descricao}
                    {r.itens && r.itens.length > 0 && <span className="text-foreground/60"> (ex.: {r.itens.slice(0, 6).join("; ")})</span>}
                  </li>
                ))}
              </ul>
            )}

            {plano.removiveisTotal > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3">
                <p className="font-semibold">
                  {plano.removiveisTotal} registro(s) existem no banco e NÃO estão mais na planilha. Coincidência de loja + dia + valor é só uma pista — não prova que seja o mesmo lançamento.
                </p>
                <p className="mt-1">
                  Em {plano.totaisDoDia.iguais} loja+dia(s) o total do dia é igual ao da planilha ({formatarReais(plano.totaisDoDia.centavosRemoviveisEmDiasIguais)}); em{" "}
                  {plano.totaisDoDia.diferentes} é diferente ({formatarReais(plano.totaisDoDia.centavosRemoviveisEmDiasDiferentes)}).
                </p>
                <div className="mt-2 max-h-56 overflow-auto rounded border border-amber-500/20 bg-white">
                  <table className="w-full text-left" aria-label="Registros só no banco">
                    <thead className="sticky top-0 bg-amber-100">
                      <tr>
                        <th className="px-2 py-1">Data</th>
                        <th className="px-2 py-1">Loja</th>
                        <th className="px-2 py-1">Chave</th>
                        <th className="px-2 py-1 text-right">Valor</th>
                        <th className="px-2 py-1">Planilha no mesmo dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plano.removiveis.map((r) => (
                        <tr key={r.id} className="border-t border-amber-500/10">
                          <td className="px-2 py-1">{dataBR(r.data)}</td>
                          <td className="px-2 py-1">{r.unidade}</td>
                          <td className="px-2 py-1">{r.chave.join(" | ") || "—"}</td>
                          <td className="px-2 py-1 text-right">{formatarReais(r.centavos)}</td>
                          <td className="px-2 py-1 text-foreground/70">
                            {r.candidatasNoMesmoDia.length === 0
                              ? "sem linha da planilha nesse dia"
                              : r.candidatasNoMesmoDia.map((c) => `${c.chave.join(" | ") || "—"} ${formatarReais(c.centavos)}${c.mesmoValor ? " (mesmo valor)" : ""}`).join("; ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {plano.removiveisTruncados && <p className="mt-1 text-foreground/60">Lista limitada às primeiras linhas; o hash do plano cobre todos os {plano.removiveisTotal} registros.</p>}
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-ragga-blue/15 p-3">
              {plano.removiveisTotal > 0 && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(opcoes.semExclusao)}
                    disabled={lendo || confirmando || gravado}
                    onChange={(e) => void alterarOpcao({ ...opcoes, semExclusao: e.target.checked })}
                  />
                  <span>Gravar somente novos/alterados e <b>preservar</b> os registros só no banco (nenhuma exclusão).</span>
                </label>
              )}
              {riscoConfirmavel && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(opcoes.confirmarDiasSemMovimento)}
                    disabled={lendo || confirmando || gravado}
                    onChange={(e) => void alterarOpcao({ ...opcoes, confirmarDiasSemMovimento: e.target.checked })}
                  />
                  <span>Confirmo que os dias listados em “DIAS_SEM_MOVIMENTO” realmente não tiveram movimento (libera a exclusão deles).</span>
                </label>
              )}
              {exigeTexto && (
                <div>
                  <p className="font-semibold">
                    Exclusão de {nExclusoes} registro(s): exige backup, confirmação digitada e o hash do plano ({plano.hashPlano.slice(0, 12)}…).
                  </p>
                  {!previa?.conectado || !previa.exclusoesHabilitadas ? (
                    <p className="mt-1 text-semaforo-vermelho" data-testid="exclusoes-desabilitadas">Exclusões desabilitadas neste ambiente (opt-in: exigem SINCRONIZACAO_EXCLUSOES_HABILITADAS=1). Marque “preservar” para gravar sem excluir.</p>
                  ) : !previa.backupDisponivel ? (
                    <p className="mt-1 text-semaforo-vermelho">Backup indisponível neste ambiente — a exclusão fica bloqueada.</p>
                  ) : (
                    <label className="mt-1 block">
                      Digite <b>EXCLUIR {nExclusoes}</b> para autorizar:
                      <input
                        value={textoExclusao}
                        onChange={(e) => setTextoExclusao(e.target.value)}
                        aria-label="Confirmação de exclusão"
                        className="ml-2 rounded border border-ragga-blue/20 bg-white px-2 py-1"
                      />
                    </label>
                  )}
                </div>
              )}
              {!plano.podeGravar && (
                <p className="font-semibold text-semaforo-vermelho">
                  Gravação bloqueada pelos riscos acima.{plano.removiveisTotal > 0 ? " Você pode gravar só novos/alterados marcando “preservar” (nenhuma exclusão)." : ""}
                </p>
              )}
              <button
                type="button"
                disabled={!podeConfirmar}
                onClick={() => void confirmar()}
                className="rounded-md bg-ragga-blue-dark px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {confirmando ? "Gravando..." : nExclusoes > 0 ? `Confirmar sincronização (inclui excluir ${nExclusoes})` : "Confirmar sincronização"}
              </button>
            </div>
          </section>
        )}

        {desfecho && desfecho.status === "gravado" && (
          <div role="status" className="mt-3 rounded-lg border border-semaforo-verde/30 bg-semaforo-verde/10 px-4 py-3 text-sm text-ragga-blue-dark">
            🟢 <b>Sincronização gravada.</b>
            <div className="mt-1 text-xs text-foreground/70">
              Inseridos: {desfecho.inseridos} · Atualizados: {desfecho.atualizados} · Removidos: {desfecho.removidos} · Total no escopo: {formatarReais(desfecho.totalNoEscopoDepois.centavos)}
              {horaAplicado && <> · Aplicado em: {horaAplicado}</>}
            </div>
            {desfecho.backup && <div className="mt-1 break-all text-xs text-foreground/70">Backup: {desfecho.backup}</div>}
          </div>
        )}
        {desfecho && desfecho.status !== "gravado" && (
          <div role="alert" className="mt-3 rounded-lg border border-semaforo-vermelho/30 bg-semaforo-vermelho/10 px-4 py-3 text-sm text-ragga-blue-dark">
            🔴 <b>{desfecho.status === "revertido" ? "Transação revertida — nada foi gravado." : "Gravação bloqueada — nada foi gravado."}</b> {desfecho.motivo}
          </div>
        )}
        {erro && <p role="alert" className="mt-2 text-sm text-semaforo-vermelho">{erro}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              limpar();
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-md border border-ragga-blue/15 px-4 py-2 text-sm font-medium text-ragga-blue-dark hover:bg-ragga-bg"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
