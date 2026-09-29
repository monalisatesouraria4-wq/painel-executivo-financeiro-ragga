"use client";

import { useRef, useState } from "react";
import { processarArquivoBase, type BaseInfo, type ResultadoImportacao } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";

const formatadorHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * Modal de upload — reproduz o padrão comum aos 10 modais dedicados do
 * legado (confirmado por código-fonte, ver auditoria funcional):
 * input de arquivo (.xlsx) → "Lendo arquivo..." → validação/parser →
 * banner verde de sucesso (com inseridos/atualizados/total) OU banner
 * vermelho de erro (mensagem específica) → banner azul fixo "Válido
 * apenas para esta sessão do navegador — recarregar a página restaura a
 * base original". Fecha por X, clique fora, ou "Cancelar".
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
  const inputRef = useRef<HTMLInputElement>(null);

  async function selecionarArquivo(file: File) {
    setLendo(true);
    setResultado(null);
    try {
      const r = await processarArquivoBase(base.id, file, estadoAtual, new Date());
      setResultado(r);
      if (r.status === "sucesso") {
        setHoraAplicado(formatadorHora.format(new Date()));
        onSucesso(r.novoEstado);
      }
    } finally {
      setLendo(false);
    }
  }

  function fecharPorBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onFechar();
  }

  return (
    <div
      onClick={fecharPorBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg rounded-lg bg-ragga-surface p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-ragga-blue-dark">
            {base.icone} Atualizar base: {base.nome}
          </h3>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-foreground/50 hover:bg-ragga-bg"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-foreground/50">
          Arquivo esperado: {base.arquivoEsperado} (aceita .xlsx com nome equivalente)
        </p>

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

        {resultado?.status === "sucesso" && (
          <>
            <div className="mt-3 rounded-lg border border-semaforo-verde/30 bg-semaforo-verde/10 px-4 py-3 text-sm text-ragga-blue-dark">
              🟢 <b>Base atualizada com sucesso.</b>
              <div className="mt-1 text-xs text-foreground/70">
                Novos: {resultado.inseridos} · Atualizados: {resultado.atualizados} · Total: {resultado.totalFinal}
                {horaAplicado && <> · Aplicado em: {horaAplicado}</>}
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-xs text-ragga-blue-dark">
              {resultado.persistidoNoBanco ? (
                <>💾 Gravado no banco de dados — os dados continuam disponíveis após recarregar a página.</>
              ) : (
                <>
                  ℹ️ Válido apenas para esta sessão do navegador — recarregar a página restaura a base
                  original.
                </>
              )}
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setResultado(null);
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
