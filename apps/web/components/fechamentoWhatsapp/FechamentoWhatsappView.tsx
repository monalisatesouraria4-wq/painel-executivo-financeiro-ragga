"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { buildWhatsappText, type FechamentoWhatsappData } from "@/lib/services/fechamentoWhatsapp";
import { buscarFechamentoWhatsappPorData } from "@/lib/actions/buscarFechamentoWhatsappPorData";
import { gerarImagemRelatorio, baixarImagem } from "./gerarImagemRelatorio";

/**
 * Reproduz `renderWhatsapp`/`initWhatsappControls` (legado, linhas
 * 4183-4266): título com subtítulo dinâmico, banner "sem dados de
 * faturamento", botão "Copiar texto", campo livre "Tratativas
 * realizadas" (nunca persistido — igual ao legado).
 *
 * "Gerar imagem": desenha em `<canvas>` (`gerarImagemRelatorio.ts`,
 * API nativa do navegador, sem dependência nova) exatamente os mesmos
 * dados/valores do texto acima (`dados.report`) — formato vertical,
 * fundo branco, identidade azul do painel, pronta para baixar/enviar
 * pelo WhatsApp.
 */
export function FechamentoWhatsappView({ dadosIniciais }: { dadosIniciais: FechamentoWhatsappData }) {
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(new Date()));
  const [dados, setDados] = useState(dadosIniciais);
  const [tratativas, setTratativas] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const resultado = await buscarFechamentoWhatsappPorData(dataDoInput(novaData));
      setDados(resultado);
    });
  }

  async function copiarTexto() {
    if (!dados.report) return;
    const texto = buildWhatsappText(dados.report);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de clipboard — sem fallback de execCommand (API
      // deprecada); o texto já está disponível para seleção manual na UI.
    }
  }

  async function gerarImagem() {
    if (!dados.report) return;
    setErroImagem(null);
    setGerandoImagem(true);
    try {
      const blob = await gerarImagemRelatorio(dados.report, tratativas);
      baixarImagem(blob, dados.dateStr);
    } catch (err) {
      setErroImagem(err instanceof Error ? err.message : "Falha ao gerar a imagem.");
    } finally {
      setGerandoImagem(false);
    }
  }

  return (
    <main className="flex-1 space-y-4 px-6 py-6">
      <div>
        <h2 className="text-lg font-semibold text-ragga-blue-dark">Fechamento WhatsApp</h2>
        <p className="text-sm text-foreground/60">
          · relatório consolidado do Grupo Londrino · {dados.dateStr}
        </p>
      </div>

      <div className="rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). O relatório
          fica pendente até a carga de dados reais ser autorizada — nenhum valor foi inventado.
        </div>
      )}

      {dados.conectado && dados.semDados && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Nenhuma base tem dados para <b>{dados.dateStr}</b>. O relatório é gerado mesmo assim,
          com R$ 0,00 nos itens sem dado nesta data específica.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
            Texto do relatório
          </p>
          {dados.report ? (
            <pre className="mt-2 whitespace-pre-wrap text-sm text-foreground">
              {buildWhatsappText(dados.report)}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-foreground/50">Sem dados para esta referência</p>
          )}
          <button
            type="button"
            onClick={copiarTexto}
            disabled={!dados.report}
            className="mt-4 rounded-md bg-ragga-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ragga-blue-dark disabled:cursor-not-allowed disabled:bg-foreground/20"
          >
            📋 {copiado ? "Copiado!" : "Copiar texto"}
          </button>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
            ⚠️ Tratativas realizadas (opcional — só aparece na imagem, se preenchido)
          </p>
          <textarea
            value={tratativas}
            onChange={(e) => setTratativas(e.target.value)}
            placeholder="Digite aqui as tratativas realizadas, se houver. Deixe em branco para não incluir essa seção na imagem."
            rows={6}
            className="mt-2 w-full rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={gerarImagem}
            disabled={!dados.report || gerandoImagem}
            className="mt-4 rounded-md bg-ragga-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ragga-blue-dark disabled:cursor-not-allowed disabled:bg-foreground/20"
          >
            🖼️ {gerandoImagem ? "Gerando..." : "Gerar imagem"}
          </button>
          {erroImagem && <p className="mt-2 text-xs text-semaforo-vermelho">{erroImagem}</p>}
        </Card>
      </div>
    </main>
  );
}
