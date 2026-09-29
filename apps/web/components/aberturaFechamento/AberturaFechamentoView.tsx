"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";
import { buscarAberturaFechamentoPorData } from "@/lib/actions/buscarAberturaFechamentoPorData";

// timeZone: "UTC" — datas puras (meia-noite UTC), mesmo padrão de ConferenciaTab.tsx.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function CardResumo({
  icone,
  titulo,
  valor,
  tom,
}: {
  icone: string;
  titulo: string;
  valor: number;
  tom: "neutro" | "alerta";
}) {
  return (
    <Card className={tom === "alerta" && valor > 0 ? "border-semaforo-vermelho/40 bg-semaforo-vermelho/5" : undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {icone} {titulo}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tom === "alerta" && valor > 0 ? "text-semaforo-vermelho" : "text-ragga-blue-dark"
        }`}
      >
        {valor}
      </p>
    </Card>
  );
}

export function AberturaFechamentoView({
  dataInicial,
  dadosIniciais,
}: {
  dataInicial: Date;
  dadosIniciais: AberturaFechamentoData;
}) {
  const [dataSelecionada, setDataSelecionada] = useState(paraInputDate(dataInicial));
  const [dados, setDados] = useState(dadosIniciais);
  const [pendente, iniciarTransicao] = useTransition();

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const resultado = await buscarAberturaFechamentoPorData(dataDoInput(novaData));
      setDados(resultado);
    });
  }

  const linhasEmAberto = dados.linhas.filter((l) => l.situacao === "Aberto");

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-6">
      {/* Filtro de data — sempre visível, nunca escondido atrás de um toggle */}
      <div className="rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados não conectado — nenhum valor foi inventado.
        </div>
      )}

      {dados.conectado && !dados.disponivel && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Esta base ainda não tem dados para <b>{formatadorData.format(new Date(`${dataSelecionada}T00:00:00.000Z`))}</b>.
          {dados.dataMaisRecenteDisponivel && (
            <> Última data com dado disponível: <b>{formatadorData.format(dados.dataMaisRecenteDisponivel)}</b>.</>
          )}
        </div>
      )}

      {dados.conectado && dados.disponivel && (
        <>
          {/* Resumo do dia */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CardResumo icone="🟢" titulo="Caixas abertos (com movimento)" valor={dados.abertos} tom="neutro" />
            <CardResumo icone="🔵" titulo="Caixas fechados" valor={dados.fechados} tom="neutro" />
            <CardResumo icone="🔴" titulo="Caixas em aberto" valor={dados.emAberto} tom="alerta" />
            <CardResumo icone="📦" titulo="Total de caixas com movimento" valor={dados.totalCaixas} tom="neutro" />
          </section>
          <p className="text-xs text-foreground/50">
            Relação: {dados.abertos} abertos × {dados.fechados} fechados × {dados.emAberto} em aberto. &quot;Total de
            caixas&quot; corresponde ao total com abertura registrada nesta data — os dados atuais não têm uma lista
            fixa de caixas esperados por loja para comparar.
          </p>

          {/* Alerta */}
          {dados.emAberto > 0 ? (
            <div className="rounded-lg border border-semaforo-vermelho/40 bg-semaforo-vermelho/5 px-4 py-3 text-sm">
              <p className="font-semibold text-semaforo-vermelho">
                ⚠️ Existem {dados.emAberto} caixa(s) em aberto nesta data
              </p>
              <ul className="mt-2 space-y-1 text-ragga-blue-dark">
                {linhasEmAberto.map((l, i) => (
                  <li key={`${l.unidade}-${l.caixa}-${i}`}>
                    <span className="font-medium">{l.unidade}</span> — {l.caixa}
                    {l.operador && <> · Operador: {l.operador}</>} · Situação: {l.situacao}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-semaforo-verde/40 bg-semaforo-verde/5 px-4 py-3 text-sm font-semibold text-semaforo-verde">
              ✅ Todos os caixas estão fechados
            </div>
          )}

          {/* Tabela detalhada */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Detalhamento por caixa</h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                    <th className="px-4 py-2">Loja</th>
                    <th className="px-4 py-2">Caixa</th>
                    <th className="px-4 py-2">Operador</th>
                    <th className="px-4 py-2">Movimento</th>
                    <th className="px-4 py-2">Abertura</th>
                    <th className="px-4 py-2">Fechamento</th>
                    <th className="px-4 py-2">Situação</th>
                    <th className="px-4 py-2">Dif. Fechamento</th>
                    <th className="px-4 py-2">Dif. Conciliação</th>
                    <th className="px-4 py-2">Dif. Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.length === 0 ? (
                    <EstadoVazio colSpan={10} />
                  ) : (
                    dados.linhas.map((l, i) => (
                      <tr
                        key={`${l.unidade}-${l.caixa}-${l.movimento}-${i}`}
                        className={`border-b border-ragga-blue/5 last:border-0 ${
                          l.situacao === "Aberto" ? "bg-semaforo-vermelho/5" : ""
                        }`}
                      >
                        <td className="px-4 py-2 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-4 py-2">{l.caixa}</td>
                        <td className="px-4 py-2">{l.operador ?? "—"}</td>
                        <td className="px-4 py-2">{l.movimento}</td>
                        <td className="px-4 py-2">{l.abertura ?? "—"}</td>
                        <td className="px-4 py-2">{l.fechamento ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={l.situacao === "Aberto" ? "font-medium text-semaforo-vermelho" : ""}>
                            {l.situacao}
                          </span>
                        </td>
                        <td className="px-4 py-2">{l.difFechamento !== null ? formatadorMoeda.format(l.difFechamento) : "—"}</td>
                        <td className="px-4 py-2">{l.difConciliacao !== null ? formatadorMoeda.format(l.difConciliacao) : "—"}</td>
                        <td className="px-4 py-2">{l.difTotal !== null ? formatadorMoeda.format(l.difTotal) : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
