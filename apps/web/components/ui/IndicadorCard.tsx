import { Card } from "./Card";
import { SemaforoBadge } from "./SemaforoBadge";
import type { CorSemaforo } from "@/lib/rules/semaforos";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
// timeZone: "UTC" — datas desta camada são "puras" (meia-noite UTC), mesmo padrão já usado em outras telas.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

interface IndicadorCardProps {
  titulo: string;
  disponivel: boolean;
  valor?: number;
  percentualFaturamento?: number;
  semaforo?: CorSemaforo;
  textoSemaforo?: string;
  observacao?: string;
  /** Data real do registro mostrado (item 4/5 da etapa de revisão — nunca esconder de qual data veio o valor). */
  dataRegistro?: Date;
  /** true = D-1 não tinha dado; este é o último registro real disponível daquele indicador. */
  ultimoRegistroDisponivel?: boolean;
}

const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

export function IndicadorCard({
  titulo,
  disponivel,
  valor,
  percentualFaturamento,
  semaforo,
  textoSemaforo,
  observacao,
  dataRegistro,
  ultimoRegistroDisponivel,
}: IndicadorCardProps) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      {disponivel ? (
        <>
          <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">
            {valor !== undefined ? formatadorMoeda.format(valor) : "—"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {percentualFaturamento !== undefined && (
              <span className="text-xs text-foreground/60">
                {formatadorPercentual.format(percentualFaturamento)}% do faturamento
              </span>
            )}
            {semaforo && <SemaforoBadge cor={semaforo} texto={textoSemaforo ?? TEXTO_SEMAFORO[semaforo]} />}
          </div>
          {dataRegistro && (
            <p className="mt-1 text-xs text-foreground/50">
              {ultimoRegistroDisponivel ? `Último registro: ${formatadorData.format(dataRegistro)}` : formatadorData.format(dataRegistro)}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground/30">—</p>
          <p className="mt-2 text-xs text-foreground/50">
            {observacao ?? "Aguardando conexão com dados reais"}
          </p>
        </>
      )}
    </Card>
  );
}
