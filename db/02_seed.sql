-- CondoHub — dados iniciais tirados dos protótipos (opcional, para desenvolvimento)

BEGIN;

DO $$
DECLARE
  c uuid := '11111111-1111-1111-1111-111111111111';   -- id fixo para facilitar o uso da API na POC
BEGIN
  INSERT INTO condominium (id, name, management_company)
  VALUES (c, 'Residencial Jardins', 'Administradora Master');

  INSERT INTO maintenance_type (condominium_id, name)
  SELECT c, t FROM unnest(ARRAY[
    'Elétrica', 'Hidráulica', 'Limpeza', 'Estrutura e pintura', 'Portões e acesso',
    'Elevador', 'Ar-condicionado', 'Piscina', 'Jardinagem', 'Outro'
  ]) AS t;

  INSERT INTO condo_space
    (condominium_id, name, description, capacity, icon, booking_mode, opens_at, closes_at, slot_minutes, max_per_unit, requires_terms)
  VALUES
    (c, 'Salão de festas',      'Até 80 pessoas · dia todo',    80,   'sparkle', 'full_day', NULL,    NULL,    NULL, 3, true),
    (c, 'Churrasqueira',        'Até 30 pessoas · dia todo',    30,   'flame',   'full_day', NULL,    NULL,    NULL, 3, true),
    (c, 'Quadra poliesportiva', 'Quadra · 07h às 22h',          NULL, 'ball',    'hourly',   '07:00', '22:00', 120,  3, true),
    (c, 'Espaço gourmet',       'Até 20 pessoas · 10h às 23h',  20,   'chef',    'hourly',   '10:00', '23:00', 180,  3, true),
    (c, 'Piscina',              'Área descoberta · 09h às 18h', NULL, 'waves',   'hourly',   '09:00', '18:00', 120,  3, true),
    (c, 'Sala de jogos',        'Sinuca · 10h às 22h',          NULL, 'gamepad', 'hourly',   '10:00', '22:00', 120,  3, true);

  -- Locais de manutenção: as áreas reserváveis entram ligadas ao condo_space.
  INSERT INTO maintenance_location (condominium_id, name, condo_space_id)
  SELECT c, s.name, s.id FROM condo_space s WHERE s.condominium_id = c;

  INSERT INTO maintenance_location (condominium_id, name)
  SELECT c, l FROM unnest(ARRAY[
    'Garagem G1', 'Garagem G2',
    'Hall · Bloco A', 'Hall · Bloco B', 'Térreo · Bloco B',
    'Elevador social · Bloco A', 'Elevador social · Bloco B', 'Elevador de serviço · Bloco B',
    'Portaria', 'Academia'
  ]) AS l;
END;
$$;

COMMIT;
