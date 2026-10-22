"use client";

import { useEffect, useMemo, useState } from "react";
import { Secao } from "@/components/ui/PainelAnalitico";
import { buscarResumoExecutivo } from "@/lib/actions/buscarResumoExecutivo";
import type { RespostaResumoExecutivo } from "@/lib/services/resumoExecutivo.server";
import { modeloDaImagem, textoWhatsappSemanal, type JanelaSemana, type ResumoExecutivo, type SecaoImagem, type TomVariacao } from "@/lib/services/resumoExecutivo";
import { semanaRealISO, somaDiasISO } from "@/lib/services/trocoSemanal";
import { baixarImagemResumo, gerarImagemResumoSemanal, type ImagemGerada } from "./gerarImagemResumoSemanal";

/**
 * Resumo Semanal Executivo — bloco principal: filtro de data (a semana segunda→domingo que contém a data), cartões "big numbers",
 * formas de pagamento, detalhamento por indicador, botão que GERA a imagem (PNG com a logo oficial) e texto para copiar no WhatsApp.
 * Tela, imagem e texto vêm do mesmo `ResumoExecutivo`, então período e valores são idênticos nos três.
 */

const COR_TOM: Record<TomVariacao, string> = { bom: "text-semaforo-verde", ruim: "text-semaforo-vermelho", neutro: "text-foreground/55" };
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function BlocoSecao({ s }: { s: SecaoImagem }) {
  return (
    <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ragga-blue-dark">{s.titulo}</h3>
        {s.total && <span className="text-sm font-bold tabular-nums text-foreground">{s.total}</span>}
      </div>
      <ul className="space-y-1 text-sm">
        {s.linhas.map((l, i) => (
          <li key={`${l.texto}-${i}`} className={`flex justify-between gap-3 ${l.destaque ? "font-semibold text-ragga-blue-dark" : ""}`}>
            <span>{l.texto}</span>
            {l.valor && <span className="shrink-0 font-semibold tabular-nums">{l.valor}</span>}
          </li>
        ))}
      </ul>
      {s.nota && <p className="mt-2 text-xs italic text-foreground/55">{s.nota}</p>}
    </div>
  );
}

export function ResumoExecutivoPainel({ hoje, ultimaSemana, inicial }: { hoje: string; ultimaSemana: JanelaSemana; inicial: RespostaResumoExecutivo }) {
  const [dataSel, setDataSel] = useState(ultimaSemana.inicio);
  const semana = useMemo(() => semanaRealISO(dataSel), [dataSel]);
  const completa = semana.fim <= ultimaSemana.fim; // só semanas fechadas (a semana em andamento não é oferecida)
  const chave = `${semana.inicio}|${semana.fim}`;
  const [carregado, setCarregado] = useState<{ chave: string; resposta: RespostaResumoExecutivo } | null>({ chave: `${ultimaSemana.inicio}|${ultimaSemana.fim}`, resposta: inicial });
  // a imagem/erro vale só para a semana em que foi gerada (chave): trocar a semana "esquece" a imagem sem efeito de reset
  const [imagemGuardada, setImagemGuardada] = useState<{ chave: string; imagem: ImagemGerada } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroGuardado, setErroGuardado] = useState<{ chave: string; mensagem: string } | null>(null);
  const imagem = imagemGuardada?.chave === chave ? imagemGuardada.imagem : null;
  const erroImagem = erroGuardado?.chave === chave ? erroGuardado.mensagem : null;
  const [copiado, setCopiado] = useState(false);
  const [mostrarTexto, setMostrarTexto] = useState(false);

  useEffect(() => {
    if (!completa || carregado?.chave === chave) return;
    let vivo = true;
    buscarResumoExecutivo(semana)
      .then((resposta) => vivo && setCarregado({ chave, resposta }))
      .catch(() => vivo && setCarregado({ chave, resposta: { conectado: true, resumo: null, erro: "Não foi possível carregar o resumo agora. Tente novamente.", geradoEm: new Date().toISOString() } }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, completa]);

  const atualizando = completa && carregado?.chave !== chave;
  const resposta = !atualizando ? carregado?.resposta : null;
  const resumo: ResumoExecutivo | null = resposta?.resumo ?? null;
  const modelo = useMemo(() => (resumo ? modeloDaImagem(resumo) : null), [resumo]);
  const texto = useMemo(() => (resumo ? textoWhatsappSemanal(resumo) : ""), [resumo]);

  async function gerar() {
    if (!modelo || !resposta) return;
    setErroGuardado(null);
    setGerando(true);
    try {
      setImagemGuardada({ chave, imagem: await gerarImagemResumoSemanal(modelo, resposta.geradoEm) });
    } catch (e) {
      setErroGuardado({ chave, mensagem: e instanceof Error ? e.message : "Não foi possível gerar a imagem." });
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const area = document.createElement("textarea");
      area.value = texto;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <div className="space-y-4" data-testid="resumo-executivo">
      <Secao
        titulo="Resumo executivo para WhatsApp"
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={gerar}
              disabled={!modelo || gerando}
              className="rounded-md bg-ragga-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-ragga-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {gerando ? "Gerando imagem…" : "🖼️ Gerar imagem"}
            </button>
            <button
              type="button"
              onClick={copiar}
              disabled={!modelo}
              className="rounded-md border border-ragga-blue/25 bg-white px-4 py-2 text-sm font-semibold text-ragga-blue-dark hover:bg-ragga-blue/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copiado ? "✓ Texto copiado" : "📋 Copiar texto"}
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-foreground/55">
            Data (a semana que a contém)
            <input
              type="date"
              value={dataSel}
              max={ultimaSemana.fim}
              onChange={(e) => e.target.value && setDataSel(e.target.value)}
              className="mt-1 block rounded-md border border-ragga-blue/20 bg-white px-3 py-2 text-sm text-ragga-blue-dark"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDataSel(somaDiasISO(semana.inicio, -7))} className="rounded-md px-3 py-2 text-sm font-medium text-ragga-blue hover:bg-ragga-blue/5">
              ← Semana anterior
            </button>
            <button
              type="button"
              disabled={semana.fim >= ultimaSemana.fim}
              onClick={() => setDataSel(somaDiasISO(semana.inicio, 7))}
              className="rounded-md px-3 py-2 text-sm font-medium text-ragga-blue hover:bg-ragga-blue/5 disabled:opacity-40"
            >
              Próxima semana →
            </button>
          </div>
          <p className="text-sm text-foreground/70">
            Semana consultada: <strong className="text-ragga-blue-dark">{dataBR(semana.inicio)} a {dataBR(semana.fim)}</strong> (segunda a domingo)
          </p>
        </div>
        {!completa && (
          <p className="mt-3 rounded-md bg-semaforo-amarelo/10 px-3 py-2 text-sm text-semaforo-amarelo">
            A semana de {dataBR(semana.inicio)} a {dataBR(semana.fim)} ainda não terminou (hoje é {dataBR(hoje)}). O resumo é gerado só para semanas completas: escolha uma data até {dataBR(ultimaSemana.fim)}.
          </p>
        )}
        {atualizando && <p className="mt-3 text-sm text-foreground/55">Carregando…</p>}
        {resposta?.erro && <p className="mt-3 rounded-md bg-semaforo-vermelho/10 px-3 py-2 text-sm text-semaforo-vermelho">{resposta.erro}</p>}
        {resposta && !resposta.conectado && <p className="mt-3 text-sm text-foreground/55">Banco de dados não conectado neste ambiente.</p>}
        {erroImagem && <p className="mt-3 rounded-md bg-semaforo-vermelho/10 px-3 py-2 text-sm text-semaforo-vermelho">{erroImagem}</p>}
      </Secao>

      {modelo && resumo && (
        <>
          {resumo.semNenhumDado && (
            <p className="rounded-md bg-semaforo-amarelo/10 px-4 py-3 text-sm text-semaforo-amarelo">Nenhuma base tem dados para essa semana. Nada foi preenchido com zero.</p>
          )}

          {/* Big numbers */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="big-numbers">
            {modelo.cartoes.map((c) => (
              <div key={c.rotulo} className="rounded-xl border border-ragga-blue/10 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-foreground/50">{c.rotulo}</p>
                <p className={`mt-1 text-3xl font-extrabold tabular-nums ${c.semDados ? "text-foreground/35" : "text-ragga-blue-dark"}`}>{c.valor}</p>
                {c.variacao && <p className={`mt-0.5 text-sm font-semibold ${COR_TOM[c.tom]}`}>{c.variacao}</p>}
                {c.observacao && <p className="mt-1 text-[11px] text-foreground/50">{c.observacao}</p>}
              </div>
            ))}
          </div>

          {/* Formas de pagamento */}
          <Secao titulo="Formas de pagamento">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {modelo.formas.map((f) => (
                <div key={f.rotulo} className="rounded-lg bg-ragga-bg px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground/50">{f.rotulo}</p>
                  <p className={`text-xl font-extrabold tabular-nums ${f.semDados ? "text-foreground/35" : "text-ragga-blue-dark"}`}>{f.valor}</p>
                </div>
              ))}
            </div>
            {modelo.notaFormas && <p className="mt-3 text-xs italic text-semaforo-amarelo">{modelo.notaFormas}</p>}
          </Secao>

          {/* Detalhamento */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {modelo.secoes.map((s) => (
              <BlocoSecao key={s.titulo} s={s} />
            ))}
          </div>

          {modelo.avisos.length > 0 && (
            <ul className="space-y-1 rounded-md bg-semaforo-amarelo/10 px-4 py-3 text-xs text-semaforo-amarelo">
              {modelo.avisos.map((a) => (
                <li key={a}>ℹ {a}</li>
              ))}
            </ul>
          )}

          {/* Imagem gerada + texto */}
          {imagem && (
            <Secao
              titulo="Imagem gerada"
              acao={
                <button
                  type="button"
                  onClick={() => baixarImagemResumo(imagem.blob, resumo.periodo.inicio, resumo.periodo.fim)}
                  className="rounded-md bg-ragga-blue px-4 py-2 text-sm font-semibold text-white hover:bg-ragga-blue-dark"
                >
                  ⬇️ Baixar PNG
                </button>
              }
            >
              <p className="mb-3 text-xs text-foreground/55">
                {imagem.largura}×{imagem.altura}px · logo oficial da Ragga {imagem.logoDesenhada ? "incluída no arquivo" : "NÃO incluída"} · pronta para compartilhar no WhatsApp.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagem.dataUrl} alt="Resumo semanal executivo gerado" className="mx-auto w-full max-w-[540px] rounded-lg border border-ragga-blue/10" data-testid="imagem-gerada" />
            </Secao>
          )}

          <Secao
            titulo="Texto para WhatsApp"
            acao={
              <button type="button" onClick={() => setMostrarTexto((v) => !v)} className="rounded-md px-3 py-2 text-sm font-medium text-ragga-blue hover:bg-ragga-blue/5">
                {mostrarTexto ? "Ocultar texto" : "Ver texto"}
              </button>
            }
          >
            {mostrarTexto ? (
              <textarea readOnly value={texto} rows={22} className="w-full rounded-md border border-ragga-blue/15 bg-ragga-bg/40 p-3 font-mono text-xs leading-relaxed" data-testid="texto-whatsapp" />
            ) : (
              <p className="text-sm text-foreground/55">O texto usa os mesmos valores e o mesmo período da tela e da imagem. Use “Copiar texto” para colar no WhatsApp.</p>
            )}
          </Secao>
        </>
      )}
    </div>
  );
}
