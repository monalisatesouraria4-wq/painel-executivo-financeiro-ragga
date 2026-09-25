-- Faixas de semáforo aprovadas no planejamento (docs/regras-negocio.md).
-- ate_inclusive usa 999999.99 como "sem limite superior" para a última
-- faixa de cada indicador (equivalente a Infinity em
-- apps/web/lib/rules/semaforos.ts).

INSERT INTO parametros_semaforo (indicador, ordem, ate_inclusive, cor) VALUES
  ('cancelamento', 1, 0.50, 'azul'),
  ('cancelamento', 2, 1.00, 'verde'),
  ('cancelamento', 3, 2.00, 'amarelo'),
  ('cancelamento', 4, 999999.99, 'vermelho'),

  ('brindes', 1, 0.25, 'azul'),
  ('brindes', 2, 0.40, 'amarelo'),
  ('brindes', 3, 999999.99, 'vermelho'),

  ('compra_direta', 1, 5.00, 'verde'),
  ('compra_direta', 2, 7.00, 'amarelo'),
  ('compra_direta', 3, 999999.99, 'vermelho')
ON CONFLICT (indicador, ordem) DO NOTHING;
