CREATE TABLE "unidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidades_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "usuario_unidade" (
	"usuario_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	CONSTRAINT "usuario_unidade_usuario_id_unidade_id_pk" PRIMARY KEY("usuario_id","unidade_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"perfil" text DEFAULT 'financeiro_master' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_perfil_valido" CHECK ("usuarios"."perfil" in ('admin','financeiro_master','financeiro','gestor_regional','gestor_loja'))
);
--> statement-breakpoint
CREATE TABLE "brindes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"motivo" text NOT NULL,
	"motivo2" text DEFAULT '' NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"quantidade" numeric(12, 2),
	CONSTRAINT "brindes_chave" UNIQUE("unidade_id","data","motivo","motivo2")
);
--> statement-breakpoint
CREATE TABLE "cancelamento_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"motivo" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "cancelamento_delivery_chave" UNIQUE("unidade_id","data","motivo")
);
--> statement-breakpoint
CREATE TABLE "cancelamento_salao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"motivo" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "cancelamento_salao_chave" UNIQUE("unidade_id","data","motivo")
);
--> statement-breakpoint
CREATE TABLE "compra_direta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"motivo" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "compra_direta_chave" UNIQUE("unidade_id","data","motivo")
);
--> statement-breakpoint
CREATE TABLE "conferencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"qtd_cadastrados" integer NOT NULL,
	"qtd_conferidos" integer,
	"em_atraso" boolean DEFAULT false NOT NULL,
	"fonte_periodo_id" uuid NOT NULL,
	CONSTRAINT "conferencia_chave" UNIQUE("unidade_id","data"),
	CONSTRAINT "conferencia_qtd_conferidos_nulo_se_em_atraso" CHECK (NOT ("conferencia"."em_atraso" AND "conferencia"."qtd_conferidos" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "faturamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "faturamento_chave" UNIQUE("unidade_id","data")
);
--> statement-breakpoint
CREATE TABLE "formas_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"forma" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "formas_pagamento_chave" UNIQUE("unidade_id","data","forma")
);
--> statement-breakpoint
CREATE TABLE "pdv_maquininha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"forma_pagamento" text NOT NULL,
	"valor_pdv" numeric(14, 2) NOT NULL,
	"valor_maquininha" numeric(14, 2) NOT NULL,
	CONSTRAINT "pdv_maquininha_chave" UNIQUE("unidade_id","data","forma_pagamento")
);
--> statement-breakpoint
CREATE TABLE "fechamento_caixa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"caixa" text NOT NULL,
	"movimento" text NOT NULL,
	"abertura" text,
	"fechamento" text,
	"operador" text,
	"situacao" text,
	"dif_fechamento" numeric(14, 2),
	"dif_conciliacao" numeric(14, 2),
	"dif_total" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "quebra_caixa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"fonte_periodo_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retirada_deposito" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"valor" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "troco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"data" date NOT NULL,
	"importacao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"caixa" text NOT NULL,
	"troco_conferido_gerente" numeric(14, 2) NOT NULL,
	"troco_informado_colaborador" numeric(14, 2) NOT NULL,
	"diferenca" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametros_semaforo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indicador" text NOT NULL,
	"ordem" integer NOT NULL,
	"ate_inclusive" numeric(6, 2) NOT NULL,
	"cor" text NOT NULL,
	CONSTRAINT "parametros_semaforo_indicador_ordem_unica" UNIQUE("indicador","ordem"),
	CONSTRAINT "parametros_semaforo_cor_valida" CHECK ("parametros_semaforo"."cor" in ('azul','verde','amarelo','vermelho'))
);
--> statement-breakpoint
CREATE TABLE "tratativas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_id" uuid NOT NULL,
	"indicador" text NOT NULL,
	"problema" text NOT NULL,
	"evidencia_url" text,
	"acao" text NOT NULL,
	"responsavel" text NOT NULL,
	"prazo" date,
	"status" text DEFAULT 'aberto' NOT NULL,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fontes_por_periodo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_base" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"nome_aba" text NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fim" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fontes_por_periodo_arquivo_aba_unica" UNIQUE("tipo_base","arquivo_nome","nome_aba"),
	CONSTRAINT "fontes_por_periodo_tipo_base_valido" CHECK ("fontes_por_periodo"."tipo_base" in ('conferencia','quebra_caixa')),
	CONSTRAINT "fontes_por_periodo_periodo_valido" CHECK ("fontes_por_periodo"."periodo_fim" >= "fontes_por_periodo"."periodo_inicio")
);
--> statement-breakpoint
CREATE TABLE "importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_base" text NOT NULL,
	"arquivo_nome" text NOT NULL,
	"aba_utilizada" text,
	"periodo_aba_inicio" date,
	"periodo_aba_fim" date,
	"periodo_dados_inicio" date NOT NULL,
	"periodo_dados_fim" date NOT NULL,
	"usuario_id" uuid,
	"data_hora_importacao" timestamp with time zone DEFAULT now() NOT NULL,
	"linhas_processadas" integer DEFAULT 0 NOT NULL,
	"linhas_erro" integer DEFAULT 0 NOT NULL,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "importacoes_tipo_base_valido" CHECK ("importacoes"."tipo_base" in (
  'faturamento','brindes','cancelamento_salao','cancelamento_delivery',
  'compra_direta','retirada_deposito','fechamento_caixa','pdv_maquininha',
  'formas_pagamento','conferencia','troco','quebra_caixa'
)),
	CONSTRAINT "importacoes_status_valido" CHECK ("importacoes"."status" in ('sucesso','sucesso_com_avisos','falha'))
);
--> statement-breakpoint
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_unidade" ADD CONSTRAINT "usuario_unidade_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brindes" ADD CONSTRAINT "brindes_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brindes" ADD CONSTRAINT "brindes_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancelamento_delivery" ADD CONSTRAINT "cancelamento_delivery_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancelamento_delivery" ADD CONSTRAINT "cancelamento_delivery_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancelamento_salao" ADD CONSTRAINT "cancelamento_salao_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancelamento_salao" ADD CONSTRAINT "cancelamento_salao_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_direta" ADD CONSTRAINT "compra_direta_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_direta" ADD CONSTRAINT "compra_direta_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferencia" ADD CONSTRAINT "conferencia_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferencia" ADD CONSTRAINT "conferencia_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferencia" ADD CONSTRAINT "conferencia_fonte_periodo_id_fontes_por_periodo_id_fk" FOREIGN KEY ("fonte_periodo_id") REFERENCES "public"."fontes_por_periodo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faturamento" ADD CONSTRAINT "faturamento_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faturamento" ADD CONSTRAINT "faturamento_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formas_pagamento" ADD CONSTRAINT "formas_pagamento_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formas_pagamento" ADD CONSTRAINT "formas_pagamento_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdv_maquininha" ADD CONSTRAINT "pdv_maquininha_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdv_maquininha" ADD CONSTRAINT "pdv_maquininha_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_caixa" ADD CONSTRAINT "fechamento_caixa_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_caixa" ADD CONSTRAINT "fechamento_caixa_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_fonte_periodo_id_fontes_por_periodo_id_fk" FOREIGN KEY ("fonte_periodo_id") REFERENCES "public"."fontes_por_periodo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirada_deposito" ADD CONSTRAINT "retirada_deposito_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirada_deposito" ADD CONSTRAINT "retirada_deposito_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troco" ADD CONSTRAINT "troco_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troco" ADD CONSTRAINT "troco_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tratativas" ADD CONSTRAINT "tratativas_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fechamento_caixa_unidade_data_idx" ON "fechamento_caixa" USING btree ("unidade_id","data");--> statement-breakpoint
CREATE INDEX "quebra_caixa_unidade_data_idx" ON "quebra_caixa" USING btree ("unidade_id","data");--> statement-breakpoint
CREATE INDEX "retirada_deposito_unidade_data_idx" ON "retirada_deposito" USING btree ("unidade_id","data");--> statement-breakpoint
CREATE INDEX "troco_unidade_data_idx" ON "troco" USING btree ("unidade_id","data");