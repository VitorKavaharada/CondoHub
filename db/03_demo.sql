-- CondoHub — dados de demonstração para a POC (rodar depois do 02_seed.sql)
-- Pessoas, unidades, prestadores, regulamentos e regras preventivas dos protótipos.
-- Reservas e ocorrências não entram aqui: são criadas pela API.
--
-- Ids fixos (usar no cabeçalho X-User-Id da API):
--   Aline (moradora, Apto 302 B)     aaaaaaaa-0000-0000-0000-000000000001
--   Roberto Mendes (síndico)         aaaaaaaa-0000-0000-0000-000000000002
--   Marcos (morador, Apto 104 A)     aaaaaaaa-0000-0000-0000-000000000003
--   Paula (moradora, Apto 210 A)     aaaaaaaa-0000-0000-0000-000000000004  (unidade inadimplente)

BEGIN;

DO $$
DECLARE
  c        uuid := '11111111-1111-1111-1111-111111111111';
  aline    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  roberto  uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  marcos   uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  paula    uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  p        record;
BEGIN
  INSERT INTO app_user (id, name, email) VALUES
    (aline,   'Aline Costa',    'aline@exemplo.com'),
    (roberto, 'Roberto Mendes', 'roberto@exemplo.com'),
    (marcos,  'Marcos Lima',    'marcos@exemplo.com'),
    (paula,   'Paula Rocha',    'paula@exemplo.com');

  INSERT INTO condominium_user (condominium_id, user_id, role) VALUES
    (c, aline,   'resident'),
    (c, roberto, 'manager'),
    (c, marcos,  'resident'),
    (c, paula,   'resident');

  INSERT INTO unit (condominium_id, code, block, inadimplente) VALUES
    (c, '302', 'B', false), (c, '104', 'A', false),
    (c, '210', 'A', true),              -- unidade da Paula: para testar o bloqueio por inadimplência
    (c, '511', 'B', false), (c, '701', 'A', false), (c, '203', 'B', false);

  INSERT INTO unit_resident (condominium_id, unit_id, user_id, relation)
  SELECT c, u.id, x.user_id, 'resident'
    FROM (VALUES ('302', 'B', aline), ('104', 'A', marcos), ('210', 'A', paula), ('701', 'A', roberto))
         AS x (code, block, user_id)
    JOIN unit u ON u.condominium_id = c AND u.code = x.code AND u.block = x.block;

  -- Regulamentos
  INSERT INTO rules_document (condominium_id, condo_space_id, file_url, file_size_bytes, summary, version, published_by)
  SELECT c, s.id, '/files/regulamento-' || s.id || '-v1.pdf', 184320,
         E'Cancelamento sem custo até 48h antes do uso.\nO espaço deve ser devolvido limpo e organizado.\nDanos ao patrimônio são cobrados do responsável.\nSilêncio obrigatório a partir das 22h.',
         1, roberto
    FROM condo_space s WHERE s.condominium_id = c AND s.requires_terms;

  -- Prestadores e especialidades
  INSERT INTO service_provider (condominium_id, kind, name, job_title, team_size, phone, shift) VALUES
    (c, 'employee', 'Carlos Souza',      'Zelador',            1, '(11) 98812-4410', 'business_hours'),
    (c, 'employee', 'Equipe de limpeza', 'Auxiliar de limpeza', 3, 'Ramal 12',        'morning');

  INSERT INTO service_provider (condominium_id, kind, name, document, phone, contract_type, contract_valid_until) VALUES
    (c, 'external', 'Hidráulica Ramos',    '12.345.678/0001-01', '(11) 3321-9087',  'on_demand',         NULL),
    (c, 'external', 'Eletro Silva',        '23.456.789/0001-02', '(11) 97455-1203', 'on_demand',         NULL),
    (c, 'external', 'Elevadores Atlas',    '34.567.890/0001-03', '0800 771 2020',   'monthly',           '2027-03-31'),
    (c, 'external', 'Clima Frio Serviços', '45.678.901/0001-04', '(11) 4002-3311',  'semiannual_annual', '2026-11-30'),
    (c, 'external', 'Multi Reparos',       '56.789.012/0001-05', '(11) 96610-5544', 'on_demand',         NULL);

  FOR p IN
    SELECT * FROM (VALUES
      ('Carlos Souza',        'Hidráulica'), ('Carlos Souza', 'Portões e acesso'), ('Carlos Souza', 'Piscina'),
      ('Carlos Souza',        'Limpeza'),
      ('Equipe de limpeza',   'Limpeza'),
      ('Hidráulica Ramos',    'Hidráulica'),
      ('Eletro Silva',        'Elétrica'),
      ('Elevadores Atlas',    'Elevador'),
      ('Clima Frio Serviços', 'Ar-condicionado'),
      ('Multi Reparos',       'Estrutura e pintura'), ('Multi Reparos', 'Outro')
    ) AS v (provider, type_name)
  LOOP
    INSERT INTO service_provider_specialty (condominium_id, service_provider_id, maintenance_type_id)
    SELECT c, sp.id, mt.id
      FROM service_provider sp, maintenance_type mt
     WHERE sp.condominium_id = c AND sp.name = p.provider
       AND mt.condominium_id = c AND mt.name = p.type_name;
  END LOOP;

  -- Regras preventivas da agenda
  INSERT INTO preventive_maintenance
    (condominium_id, name, description, maintenance_type_id, location_id, trigger_type,
     frequency, first_run_date, run_time, trigger_event, execution_window, default_provider_id,
     next_run_at, is_active, created_by)
  SELECT c, r.name, r.description, mt.id, ml.id, r.trigger_type::preventive_trigger,
         r.frequency::preventive_frequency, r.first_run_date::date, r.run_time::time,
         r.trigger_event::preventive_event, r.execution_window::preventive_window, sp.id,
         CASE WHEN r.trigger_type = 'recurring'
              THEN (r.next_run::date + r.run_time::time) AT TIME ZONE 'America/Sao_Paulo' END,
         r.is_active, roberto
    FROM (VALUES
      ('Limpeza pós-reserva · Salão',         'Limpeza completa após o uso', 'Limpeza', 'Salão de festas', 'event',     NULL,         NULL,         NULL,    'reservation_ended', 'within_4h', 'Equipe de limpeza',   NULL,         true),
      ('Limpeza pós-reserva · Churrasqueira', 'Limpeza completa após o uso', 'Limpeza', 'Churrasqueira',   'event',     NULL,         NULL,         NULL,    'reservation_ended', 'within_4h', 'Equipe de limpeza',   NULL,         true),
      ('Limpeza pós-reserva · Gourmet',       'Limpeza completa após o uso', 'Limpeza', 'Espaço gourmet',  'event',     NULL,         NULL,         NULL,    'reservation_ended', 'within_4h', 'Equipe de limpeza',   NULL,         true),
      ('Manutenção da churrasqueira',         'Grelhas, coifa e ralos',      'Limpeza', 'Churrasqueira',   'recurring', 'monthly',    '2026-09-14', '08:00', NULL,                NULL,        'Carlos Souza',        '2026-11-14', true),
      ('Revisão do ar-condicionado',          'Filtros e PMOC',              'Ar-condicionado', 'Salão de festas', 'recurring', 'semiannual', '2026-04-18', '09:00', NULL,        NULL,        'Clima Frio Serviços', '2027-04-18', true),
      ('Tratamento da piscina',               'Tratamento semanal da água',  'Piscina', 'Piscina',         'recurring', 'weekly',     '2026-10-01', '07:00', NULL,                NULL,        'Carlos Souza',        '2026-11-05', true),
      ('Revisão dos elevadores',              'Obrigatória por contrato',    'Elevador', 'Elevador social · Bloco A', 'recurring', 'monthly', '2026-08-20', '09:00', NULL,          NULL,        'Elevadores Atlas',    '2026-11-20', true),
      ('Recarga de extintores',               NULL,                          'Outro',   'Portaria',        'recurring', 'annual',     '2027-03-10', '09:00', NULL,                NULL,        NULL,                  '2027-03-10', false)
    ) AS r (name, description, type_name, location_name, trigger_type, frequency, first_run_date, run_time,
            trigger_event, execution_window, provider_name, next_run, is_active)
    JOIN maintenance_type mt     ON mt.condominium_id = c AND mt.name = r.type_name
    JOIN maintenance_location ml ON ml.condominium_id = c AND ml.name = r.location_name
    LEFT JOIN service_provider sp ON sp.condominium_id = c AND sp.name = r.provider_name;
END;
$$;

COMMIT;
