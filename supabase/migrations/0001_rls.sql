-- Row Level Security (planejamento, "AUTENTICAÇÃO E PERMISSÕES").
-- Habilitado desde a fundação do schema. Nesta etapa, todo usuário criado
-- recebe 'financeiro_master' (bypass total) — a restrição por unidade só
-- passa a ter efeito prático quando usuário(s) com outro perfil e linhas em
-- usuario_unidade existirem.
--
-- Perfis com bypass total (leitura de todas as unidades): admin, financeiro_master.
-- Demais perfis: leitura restrita às unidades em usuario_unidade.
-- Escrita (INSERT/UPDATE/DELETE): apenas via service role (backend), nunca
-- diretamente pelo cliente anon/authenticated — por isso não há policy de
-- escrita aqui; o backend usa a service role key, que ignora RLS.

CREATE OR REPLACE FUNCTION public.usuario_tem_acesso_total()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = auth.uid()
      AND perfil IN ('admin', 'financeiro_master')
      AND ativo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ver_unidade(unidade uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.usuario_tem_acesso_total()
    OR EXISTS (
      SELECT 1 FROM usuario_unidade
      WHERE usuario_id = auth.uid()
        AND unidade_id = unidade
    );
$$;

ALTER TABLE unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_unidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE fontes_por_periodo ENABLE ROW LEVEL SECURITY;
ALTER TABLE importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE brindes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancelamento_salao ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancelamento_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE compra_direta ENABLE ROW LEVEL SECURITY;
ALTER TABLE retirada_deposito ENABLE ROW LEVEL SECURITY;
ALTER TABLE fechamento_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdv_maquininha ENABLE ROW LEVEL SECURITY;
ALTER TABLE formas_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE conferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE troco ENABLE ROW LEVEL SECURITY;
ALTER TABLE quebra_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_semaforo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tratativas ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado pode ler seu próprio registro e a própria lista de unidades.
CREATE POLICY usuarios_select_proprio ON usuarios
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.usuario_tem_acesso_total());

CREATE POLICY usuario_unidade_select_proprio ON usuario_unidade
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR public.usuario_tem_acesso_total());

-- Tabelas sem recorte por unidade: leitura liberada a qualquer autenticado.
CREATE POLICY unidades_select_autenticado ON unidades
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fontes_por_periodo_select_autenticado ON fontes_por_periodo
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parametros_semaforo_select_autenticado ON parametros_semaforo
  FOR SELECT TO authenticated USING (true);

CREATE POLICY importacoes_select_autenticado ON importacoes
  FOR SELECT TO authenticated USING (true);

-- Tabelas de fato e tratativas: recorte por unidade via usuario_pode_ver_unidade().
CREATE POLICY faturamento_select_unidade ON faturamento
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY brindes_select_unidade ON brindes
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY cancelamento_salao_select_unidade ON cancelamento_salao
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY cancelamento_delivery_select_unidade ON cancelamento_delivery
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY compra_direta_select_unidade ON compra_direta
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY retirada_deposito_select_unidade ON retirada_deposito
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY fechamento_caixa_select_unidade ON fechamento_caixa
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY pdv_maquininha_select_unidade ON pdv_maquininha
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY formas_pagamento_select_unidade ON formas_pagamento
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY conferencia_select_unidade ON conferencia
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY troco_select_unidade ON troco
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY quebra_caixa_select_unidade ON quebra_caixa
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));

CREATE POLICY tratativas_select_unidade ON tratativas
  FOR SELECT TO authenticated USING (public.usuario_pode_ver_unidade(unidade_id));
