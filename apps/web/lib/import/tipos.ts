import type { CodigoUnidade } from "@painel/shared";

export interface RegistroBase {
  unidade: CodigoUnidade;
  data: Date;
  valor: number;
  /** Campos adicionais específicos da base (motivo, caixa, forma, etc.). */
  extras: Record<string, string>;
  /** Número da linha na planilha de origem (auditoria/depuração). */
  linhaOrigem: number;
}

export interface RegistroRejeitado {
  linhaOrigem: number;
  motivo: string;
  valoresBrutos: Record<string, unknown>;
}

export interface ResultadoParse {
  registros: RegistroBase[];
  rejeitados: RegistroRejeitado[];
}
