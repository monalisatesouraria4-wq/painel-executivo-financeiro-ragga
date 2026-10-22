-- Quebra de Caixa: identificação por OCORRÊNCIA (lançamentos legítimos repetidos com a mesma chave natural).
-- Chave antiga: (unidade_id, data, conferente, operador, cpf, motivo)  -> não distinguia lançamentos repetidos (o upsert os somava em um).
-- Chave nova:   (unidade_id, data, conferente, operador, cpf, motivo, ocorrencia)  — o VALOR continua fora da chave.
-- `ocorrencia` = posição do lançamento, por valor crescente, dentro do grupo de mesma chave natural (ver apps/web/lib/import/ocorrenciaQuebra.ts).
--
-- NÃO EXECUTADA NO BANCO REAL (aguarda autorização explícita). Ordem de implantação: 1) esta migração; 2) código novo (o importador
-- se recusa a gravar Quebra se a coluna não existir). Idempotente e atômica: roda numa transação; reexecutar não altera o resultado.
-- Os registros existentes recebem ocorrencia = 1 (consistente com a regra: eram o único lançamento da sua chave no banco).
-- Segura com dados: apenas ADD COLUMN com DEFAULT + troca de restrição única por outra MAIS PERMISSIVA (a nova inclui uma coluna a mais),
-- portanto nenhuma linha existente pode violá-la.
BEGIN;

ALTER TABLE "quebra_caixa" ADD COLUMN IF NOT EXISTS "ocorrencia" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "quebra_caixa" DROP CONSTRAINT IF EXISTS "quebra_caixa_chave";
--> statement-breakpoint
ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_chave" UNIQUE("unidade_id","data","conferente","operador","cpf","motivo","ocorrencia");

COMMIT;

-- ROLLBACK (só se NENHUMA ocorrencia > 1 tiver sido gravada; senão a restrição antiga seria violada):
--   BEGIN;
--   ALTER TABLE "quebra_caixa" DROP CONSTRAINT "quebra_caixa_chave";
--   ALTER TABLE "quebra_caixa" ADD CONSTRAINT "quebra_caixa_chave" UNIQUE("unidade_id","data","conferente","operador","cpf","motivo");
--   ALTER TABLE "quebra_caixa" DROP COLUMN "ocorrencia";
--   COMMIT;
