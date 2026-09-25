-- As 17 unidades válidas, confirmadas nas bases reais (não executar antes
-- de validação do usuário — ver docs/regras-negocio.md).
-- BG 08 E 09 é uma única unidade. Não existem BG 09 separado nem BG 14-18.

INSERT INTO unidades (codigo, nome) VALUES
  ('BG 01', 'BG 01'),
  ('BG 02', 'BG 02'),
  ('BG 03', 'BG 03'),
  ('BG 04', 'BG 04'),
  ('BG 05', 'BG 05'),
  ('BG 06', 'BG 06'),
  ('BG 07', 'BG 07'),
  ('BG 08 E 09', 'BG 08 E 09'),
  ('BG 10', 'BG 10'),
  ('BG 11', 'BG 11'),
  ('BG 12', 'BG 12'),
  ('BG 13', 'BG 13'),
  ('IS 01', 'IS 01'),
  ('IS 02', 'IS 02'),
  ('IS 03', 'IS 03'),
  ('ROBS', 'ROBS'),
  ('MAPOLI', 'MAPOLI')
ON CONFLICT (codigo) DO NOTHING;
