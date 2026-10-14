-- Detalhe individual dos estornos do Cancelamento Salão (alerta "Cancelamentos após 00h30").
-- Tabela ADICIONAL: não altera cancelamento_salao (agregado). Chave composta + ocorrência => reimportação idempotente.
-- Escrita à mão (como a 0001): inclui índice parcial, RLS e policy. Idempotente (IF NOT EXISTS / DROP ... IF EXISTS):
-- reexecutar não recria a tabela nem duplica policy/índice. O banco compartilhado já recebeu este SQL manualmente em
-- 2026-10-14 (a FK ali tem o nome gerado pelo Postgres, "cancelamento_salao_detalhe_unidade_id_fkey").
CREATE TABLE IF NOT EXISTS "cancelamento_salao_detalhe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"estorno_em" timestamp NOT NULL,
	"data_calendario" date NOT NULL,
	"data_operacional" date NOT NULL,
	"minuto_do_dia" integer NOT NULL,
	"madrugada" boolean NOT NULL,
	"comanda" text DEFAULT '' NOT NULL,
	"produto" text DEFAULT '' NOT NULL,
	"quantidade" numeric(12, 2) DEFAULT '0' NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"justificativa" text DEFAULT '' NOT NULL,
	"atendente" text DEFAULT '' NOT NULL,
	"autorizador" text DEFAULT '' NOT NULL,
	"ocorrencia" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancelamento_salao_detalhe_chave" UNIQUE("unidade_id","estorno_em","comanda","produto","quantidade","valor","motivo","atendente","autorizador","ocorrencia"),
	CONSTRAINT "cancelamento_salao_detalhe_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancelamento_salao_detalhe_madrugada_idx" ON "cancelamento_salao_detalhe" USING btree ("data_operacional") WHERE "cancelamento_salao_detalhe"."madrugada";
--> statement-breakpoint
ALTER TABLE "cancelamento_salao_detalhe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS cancelamento_salao_detalhe_select_unidade ON "cancelamento_salao_detalhe";
--> statement-breakpoint
CREATE POLICY cancelamento_salao_detalhe_select_unidade ON "cancelamento_salao_detalhe"
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));
