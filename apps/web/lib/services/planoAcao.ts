import type { CodigoUnidade } from "@painel/shared";

/**
 * Tipos client-safe do Plano de Ação — sem import de banco (mesmo motivo
 * já documentado em indicadores.ts/analiseGerencial.ts). A tabela real é
 * `tratativas` (`lib/db/schema/gestao.ts`), já existente antes desta
 * etapa; esta etapa só implementa a tela e os Server Actions de
 * leitura/escrita — nenhuma regra de indicador foi alterada.
 */

export const STATUS_OPCOES = ["Aberto", "Em andamento", "Concluído"] as const;
export type StatusTratativa = (typeof STATUS_OPCOES)[number];

/** "Atrasado" não é um valor gravado no banco — é calculado na leitura a partir de `prazo`/`status` (ver `calcularStatusExibicao`). */
export type StatusExibicao = StatusTratativa | "Atrasado";

export interface TratativaLinha {
  id: string;
  unidade: CodigoUnidade;
  indicador: string;
  dataOcorrencia: Date | null;
  problema: string;
  acao: string;
  responsavel: string;
  prazo: Date | null;
  status: string;
  statusExibicao: StatusExibicao;
  observacao: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface FiltroTratativas {
  unidade?: CodigoUnidade;
  indicador?: string;
  status?: string;
}

export interface NovaTratativaInput {
  unidade: CodigoUnidade;
  indicador: string;
  dataOcorrencia: Date | null;
  problema: string;
  acao: string;
  responsavel: string;
  prazo: Date | null;
  observacao?: string;
}

export interface AtualizarTratativaInput {
  id: string;
  status?: string;
  responsavel?: string;
  prazo?: Date | null;
  observacao?: string | null;
}

/**
 * "Atrasado" é derivado (não gravado): `prazo` no passado e status ainda
 * não "Concluído". Não altera o texto livre armazenado em `status`.
 */
/** Variante nullable de `paraInputDate`/`dataDoInput` (`components/ui/FiltroDataReferencia.tsx`) — `prazo`/`dataOcorrencia` são opcionais em `tratativas`. */
export function paraInputDateOuVazio(data: Date | null): string {
  return data ? data.toISOString().slice(0, 10) : "";
}

export function dataDoInputOuNull(valor: string): Date | null {
  return valor ? new Date(`${valor}T00:00:00.000Z`) : null;
}

export function calcularStatusExibicao(status: string, prazo: Date | null, hoje: Date = new Date()): StatusExibicao {
  if (status === "Concluído") return "Concluído";
  if (prazo) {
    const prazoUTC = Date.UTC(prazo.getUTCFullYear(), prazo.getUTCMonth(), prazo.getUTCDate());
    const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    if (prazoUTC < hojeUTC) return "Atrasado";
  }
  return (STATUS_OPCOES as readonly string[]).includes(status) ? (status as StatusTratativa) : "Aberto";
}
