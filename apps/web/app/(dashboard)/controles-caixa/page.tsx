import { Header } from "@/components/layout/Header";
import { ControlesCaixaTabs } from "@/components/controlesCaixa/ControlesCaixaTabs";
import { buscarControlesCaixa } from "@/lib/services/controlesCaixa";
import { buscarAberturaFechamento } from "@/lib/services/aberturaFechamento.server";

/**
 * Reprodução funcional de "Controles de Caixa" do painel legado — sub-abas
 * Fechamento / PDV × Maquininha / Troco / Conferência / Quebra de Caixa
 * (ver auditoria funcional e comentários em lib/services/controlesCaixa.ts).
 * Filtro único de "Data de referência" no topo (ver ControlesCaixaTabs).
 */
export const dynamic = "force-dynamic";

export default async function ControlesCaixaPage() {
  const dataInicial = new Date();
  const [dados, dadosFechamento] = await Promise.all([
    buscarControlesCaixa(dataInicial),
    buscarAberturaFechamento(dataInicial),
  ]);

  return (
    <>
      <Header titulo="Controles de Caixa" />
      {!dados.conectado && (
        <div className="mx-6 mt-6 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). Os
          indicadores abaixo ficam pendentes até a carga de dados reais ser autorizada —
          nenhum valor foi inventado.
        </div>
      )}
      <ControlesCaixaTabs dadosIniciais={dados} dadosFechamentoIniciais={dadosFechamento} dataInicial={dataInicial} />
    </>
  );
}
