import { pgTable, uuid, text, numeric, integer, date, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { unidades } from "./dimensoes";

/**
 * Faixas de semáforo (planejamento, "SEMÁFOROS ATUAIS"). Os valores
 * aprovados são o seed inicial (ver supabase/seed) — não hardcoded no
 * código de cálculo (apps/web/lib/rules/semaforos.ts lê daqui em runtime
 * a partir da Etapa 3; nesta etapa a tabela só é criada e populada).
 */
export const parametrosSemaforo = pgTable(
  "parametros_semaforo",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    indicador: text("indicador").notNull(), // ex: 'cancelamento', 'brindes', 'compra_direta'
    ordem: integer("ordem").notNull(), // ordem de avaliação das faixas (crescente)
    ateInclusive: numeric("ate_inclusive", { precision: 6, scale: 2 }).notNull(), // percentual; null-equivalente = usar valor muito alto p/ última faixa
    cor: text("cor").notNull(),
  },
  (table) => [
    unique("parametros_semaforo_indicador_ordem_unica").on(table.indicador, table.ordem),
    check("parametros_semaforo_cor_valida", sql`${table.cor} in ('azul','verde','amarelo','vermelho')`),
  ]
);

/** Plano de Ação (planejamento, item 6). */
export const tratativas = pgTable("tratativas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  unidadeId: uuid("unidade_id")
    .notNull()
    .references(() => unidades.id),
  indicador: text("indicador").notNull(),
  dataOcorrencia: date("data_ocorrencia", { mode: "date" }),
  problema: text("problema").notNull(),
  evidenciaUrl: text("evidencia_url"),
  acao: text("acao").notNull(),
  responsavel: text("responsavel").notNull(),
  prazo: date("prazo", { mode: "date" }),
  status: text("status").notNull().default("aberto"),
  observacao: text("observacao"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
