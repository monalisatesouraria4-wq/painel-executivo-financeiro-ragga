"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CardGrande, Secao, moeda } from "@/components/ui/PainelAnalitico";
import { resumirMadrugada } from "@/lib/rules/cancelamentoMadrugada";
import { buscarCancelamentoMadrugada } from "@/lib/actions/buscarCancelamentoMadrugada";
import type { MadrugadaDados } from "@/lib/services/cancelamentoMadrugada.server";

/**
 * Alerta "Cancelamentos após 00h30" da aba Cancelamento Salão. Estornos lançados entre 00h31 e 05h59, atribuídos ao dia
 * operacional ANTERIOR; usa a mesma janela de ocorrência (D-1) e o mesmo filtro de loja da aba. Os detalhes vêm da tabela
 * adicional de estornos individuais — os indicadores agregados da aba não são alterados. O segundo alerta (venda após
 * 00h30 cancelada depois) está indisponível: a base não tem o horário da venda original nem vínculo venda × cancelamento.
 */

const diaBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const horaDe = (estornoEm: string) => estornoEm.slice(11, 16);

export function CancelamentoMadrugadaAlerta({ inicioOcorrencia, fimOcorrencia, loja }: { inicioOcorrencia: string; fimOcorrencia: string; loja: string }) {
  const [dados, setDados] = useState<MadrugadaDados | null>(null);
  const [chave, setChave] = useState("");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const ultima = useRef(0);
  const chaveAtual = `${inicioOcorrencia}|${fimOcorrencia}|${loja}`;

  useEffect(() => {
    const req = ++ultima.current;
    buscarCancelamentoMadrugada(inicioOcorrencia, fimOcorrencia, loja).then((r) => {
      if (req === ultima.current) {
        setDados(r);
        setChave(`${inicioOcorrencia}|${fimOcorrencia}|${loja}`);
      }
    });
  }, [inicioOcorrencia, fimOcorrencia, loja]);

  const carregando = !dados || chave !== chaveAtual;
  const resumo = useMemo(() => resumirMadrugada(dados?.linhas ?? []), [dados]);
  const periodo = inicioOcorrencia === fimOcorrencia ? diaBR(inicioOcorrencia) : `${diaBR(inicioOcorrencia)} a ${diaBR(fimOcorrencia)}`;
  const semDetalhes = !carregando && dados && !dados.detalhesDisponiveis;
  const coberturaParcial = !carregando && dados?.cobertura && dados.cobertura.desde > inicioOcorrencia;

  function alternar(u: string) {
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  }

  const valorOuTraco = (v: string) => (carregando || semDetalhes ? "—" : v);

  return (
    <Secao titulo="🌙 Cancelamentos após 00h30">
      <p className="mb-3 text-xs text-foreground/60">
        Estornos lançados entre 00h31 e 05h59 (00h30 e 06h00 ficam de fora), atribuídos ao dia operacional anterior. Período operacional: {periodo}
        {loja !== "TODAS" ? ` · ${loja}` : ""}.
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CardGrande titulo="Estornos após 00h30">
          <p className={`mt-1 text-[1.05rem] sm:text-[1.6rem] font-extrabold leading-tight ${!carregando && resumo.estornos > 0 ? "text-semaforo-amarelo" : "text-ragga-blue-dark"}`}>{valorOuTraco(String(resumo.estornos))}</p>
          <p className="mt-2 text-xs text-foreground/45">Itens estornados (uma linha da base = um item)</p>
        </CardGrande>
        <CardGrande titulo="Valor estornado">
          <p className="mt-1 text-[1.05rem] sm:text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{valorOuTraco(moeda.format(resumo.valor))}</p>
        </CardGrande>
        <CardGrande titulo="Lojas com estorno">
          <p className="mt-1 text-[1.05rem] sm:text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{valorOuTraco(String(resumo.lojas.length))}</p>
        </CardGrande>
        <CardGrande titulo="Comandas distintas">
          <p className="mt-1 text-[1.05rem] sm:text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{valorOuTraco(String(resumo.comandas))}</p>
          <p className="mt-2 text-xs text-foreground/45">Comanda + dia operacional (o número se repete)</p>
        </CardGrande>
      </div>

      {carregando && <p className="mt-3 text-xs text-foreground/50">Carregando...</p>}
      {semDetalhes && (
        <p className="mt-3 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-sm text-ragga-blue-dark">
          Os detalhes individuais dos estornos ainda não foram importados. Reimporte o arquivo do Cancelamento Salão em Importação de Bases para habilitar este alerta.
        </p>
      )}
      {coberturaParcial && dados?.cobertura && (
        <p className="mt-3 text-[11px] text-semaforo-amarelo">⚠ Os detalhes cobrem estornos a partir de {diaBR(dados.cobertura.desde)}; o início do período pode estar incompleto.</p>
      )}
      {!carregando && dados?.detalhesDisponiveis && resumo.estornos === 0 && <p className="mt-3 text-sm text-foreground/50">Nenhum estorno entre 00h31 e 05h59 no período.</p>}

      {!carregando && resumo.estornos > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="py-2 pr-3">Loja</th>
                <th className="px-3 py-2">Estornos</th>
                <th className="hidden px-3 py-2 sm:table-cell">Comandas</th>
                <th className="px-3 py-2">Valor</th>
                <th className="hidden px-3 py-2 sm:table-cell">% do valor</th>
              </tr>
            </thead>
            <tbody>
              {resumo.lojas.map((l) => {
                const aberta = abertas.has(l.unidade);
                return (
                  <Fragment key={l.unidade}>
                    <tr onClick={() => alternar(l.unidade)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                      <td className="py-2.5 pr-3 font-semibold text-ragga-blue-dark">
                        <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                        {l.unidade}
                      </td>
                      <td className="px-3">{l.estornos}</td>
                      <td className="hidden px-3 sm:table-cell">{l.comandas}</td>
                      <td className="px-3 font-semibold">{moeda.format(l.valor)}</td>
                      <td className="hidden px-3 text-foreground/60 sm:table-cell">{resumo.valor > 0 ? `${((l.valor / resumo.valor) * 100).toFixed(1).replace(".", ",")}%` : "—"}</td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={5} className="bg-ragga-bg/60 px-3 py-3">
                          <div className="max-w-[calc(100vw-7.5rem)] overflow-x-auto sm:max-w-none">
                            <table className="w-full text-xs tabular-nums">
                              <thead>
                                <tr className="text-left font-semibold uppercase tracking-wide text-foreground/45">
                                  <th className="py-1 pr-3">Dia operacional</th>
                                  <th className="px-2 py-1">Hora do estorno</th>
                                  <th className="px-2 py-1">Comanda</th>
                                  <th className="px-2 py-1">Produto</th>
                                  <th className="px-2 py-1">Qtde.</th>
                                  <th className="px-2 py-1">Valor</th>
                                  <th className="px-2 py-1">Motivo</th>
                                  <th className="px-2 py-1">Atendente</th>
                                  <th className="px-2 py-1">Autorizador</th>
                                </tr>
                              </thead>
                              <tbody>
                                {l.linhas.map((x, i) => (
                                  <tr key={`${x.estornoEm}-${x.comanda}-${i}`} className="border-t border-ragga-blue/5">
                                    <td className="py-1 pr-3">{diaBR(x.dataOperacional)}</td>
                                    <td className="px-2">{horaDe(x.estornoEm)} ({diaBR(x.estornoEm.slice(0, 10))})</td>
                                    <td className="px-2">{x.comanda}</td>
                                    <td className="px-2">{x.produto.replace(/^\d{2}:\d{2}\s*-\s*/, "")}</td>
                                    <td className="px-2">{x.quantidade}</td>
                                    <td className="px-2">{moeda.format(x.valor)}</td>
                                    <td className="px-2">{x.motivo}</td>
                                    <td className="px-2">{x.atendente}</td>
                                    <td className="px-2">{x.autorizador}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 2º alerta: indisponível na base atual — nenhuma tentativa de correlacionar vendas e cancelamentos. */}
      <div className="mt-4 rounded-lg border border-ragga-blue/10 bg-ragga-bg/60 px-4 py-3 text-sm text-foreground/70">
        <p className="font-semibold text-ragga-blue-dark">Vendas após 00h30 canceladas posteriormente: indisponível na base atual</p>
        <p className="mt-0.5 text-xs text-foreground/55">A base não traz o horário da venda original nem um vínculo confiável entre a venda e o cancelamento, então esse alerta não é calculado.</p>
      </div>
    </Secao>
  );
}
