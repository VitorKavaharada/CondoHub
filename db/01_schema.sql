-- CondoHub — esquema PostgreSQL (PostgreSQL 14+)
-- Módulos cobertos: reserva de áreas comuns e manutenção (mesma aplicação).
-- Fontes: modelagem_dados_fluxo_reserva.xlsx, modelagem_dados_fluxo_manutencao.md
-- e os designs "CondoHub - Fluxo de Reserva" e "CondoHub - Fluxo Manutenção".
-- Divergências e acréscimos em relação às modelagens: db/validacao_modelagem.md
--
-- Multicondomínio: toda tabela de dados tem condominium_id e UNIQUE (id, condominium_id).
-- As FKs entre tabelas são compostas com condominium_id, então uma linha nunca aponta
-- para dado de outro condomínio. Usuários são globais (app_user) e entram em cada
-- condomínio por condominium_user, que guarda o papel naquele condomínio.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- EXCLUDE com "=" em uuid + "&&" em intervalo

-- =====================================================================
-- Tipos enumerados
-- =====================================================================

CREATE TYPE user_role               AS ENUM ('resident', 'manager', 'admin', 'doorman', 'technician');
CREATE TYPE unit_relation           AS ENUM ('resident', 'owner');
CREATE TYPE booking_mode            AS ENUM ('full_day', 'hourly');
CREATE TYPE reservation_status      AS ENUM ('pending', 'confirmed', 'canceled', 'rejected');

CREATE TYPE incident_origin         AS ENUM ('resident', 'manual', 'preventive');
CREATE TYPE incident_status         AS ENUM ('submitted', 'under_review', 'approved', 'in_progress', 'done', 'rejected');
CREATE TYPE incident_priority       AS ENUM ('low', 'medium', 'high');
CREATE TYPE incident_rejection      AS ENUM ('already_done', 'provider_already_requested', 'already_scheduled', 'unit_responsibility', 'other');

CREATE TYPE provider_kind           AS ENUM ('external', 'employee');
CREATE TYPE provider_contract       AS ENUM ('on_demand', 'monthly', 'semiannual_annual');
CREATE TYPE employee_shift          AS ENUM ('morning', 'afternoon', 'business_hours');

CREATE TYPE preventive_trigger      AS ENUM ('recurring', 'event');
CREATE TYPE preventive_frequency    AS ENUM ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual');
-- move_completed: ainda não há entidade de mudança que dispare este evento (decidir no desenvolvimento).
CREATE TYPE preventive_event        AS ENUM ('reservation_ended', 'reservation_canceled', 'move_completed');
CREATE TYPE preventive_window       AS ENUM ('within_2h', 'within_4h', 'next_day_10am');

-- =====================================================================
-- Função genérica de updated_at
-- =====================================================================

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- Condomínio, pessoas e unidades
-- =====================================================================

CREATE TABLE condominium (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,                -- "Residencial Jardins"
  document              text,                         -- CNPJ do condomínio
  management_company    text,                         -- "Administradora Master"
  timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',   -- limites de "dia todo"
  last_incident_number  integer NOT NULL DEFAULT 0,   -- contador do protocolo MNT-nnnn por condomínio
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX condominium_document_uk ON condominium (document) WHERE document IS NOT NULL;
COMMENT ON TABLE condominium IS 'Condomínio atendido pela aplicação (tenant)';

CREATE TABLE app_user (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,          -- conta bloqueada em todos os condomínios
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_email_chk CHECK (email = btrim(email) AND email <> '')
);
CREATE UNIQUE INDEX app_user_email_uk ON app_user (lower(email));
COMMENT ON TABLE app_user IS 'Pessoa com login; o papel e o vínculo ficam por condomínio';

CREATE TABLE condominium_user (
  condominium_id    uuid NOT NULL REFERENCES condominium (id),
  user_id           uuid NOT NULL REFERENCES app_user (id),
  role              user_role NOT NULL DEFAULT 'resident',
  is_active         boolean NOT NULL DEFAULT true,    -- se falso, não reserva nem abre solicitações
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (condominium_id, user_id)
);
CREATE INDEX condominium_user_user_idx ON condominium_user (user_id);
COMMENT ON TABLE condominium_user IS 'Participação da pessoa em um condomínio, com o papel nele (síndico pode ser morador)';

CREATE TABLE unit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL REFERENCES condominium (id),
  code            text NOT NULL,                      -- número do apartamento (302)
  block           text NOT NULL,                      -- bloco ou torre (B)
  inadimplente    boolean NOT NULL DEFAULT false,     -- pendência financeira: bloqueia reservas de todos os moradores
  CONSTRAINT unit_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT unit_code_block_uk UNIQUE (condominium_id, block, code)
);
COMMENT ON TABLE unit IS 'Unidades do condomínio';
COMMENT ON COLUMN unit.inadimplente IS 'Unidade com pendência financeira; nenhum morador dela reserva áreas comuns';

CREATE TABLE unit_resident (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL,
  unit_id         uuid NOT NULL,
  user_id         uuid NOT NULL,
  relation        unit_relation NOT NULL,
  CONSTRAINT unit_resident_uk UNIQUE (unit_id, user_id),
  CONSTRAINT unit_resident_unit_fk FOREIGN KEY (unit_id, condominium_id) REFERENCES unit (id, condominium_id),
  CONSTRAINT unit_resident_user_fk FOREIGN KEY (condominium_id, user_id) REFERENCES condominium_user (condominium_id, user_id)
);
CREATE INDEX unit_resident_user_idx ON unit_resident (condominium_id, user_id);
COMMENT ON TABLE unit_resident IS 'Vínculo entre pessoa e unidade (morador ou proprietário)';

-- =====================================================================
-- Reserva de áreas comuns
-- =====================================================================

CREATE TABLE condo_space (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id       uuid NOT NULL REFERENCES condominium (id),
  name                 text NOT NULL,
  description          text,
  capacity             integer,                       -- "Até 80 pessoas"
  icon                 text,                          -- chave do ícone exibido na lista de áreas
  booking_mode         booking_mode NOT NULL,
  opens_at             time,
  closes_at            time,
  slot_minutes         integer,
  max_per_unit         integer NOT NULL DEFAULT 3,
  booking_horizon_days integer NOT NULL DEFAULT 90,   -- até quantos dias à frente o calendário abre
  requires_terms       boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT condo_space_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT condo_space_name_uk UNIQUE (condominium_id, name),
  CONSTRAINT condo_space_capacity_chk CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT condo_space_max_per_unit_chk CHECK (max_per_unit BETWEEN 1 AND 10),
  CONSTRAINT condo_space_horizon_chk CHECK (booking_horizon_days > 0),
  CONSTRAINT condo_space_hourly_chk CHECK (
    booking_mode <> 'hourly'
    OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at
        AND slot_minutes IS NOT NULL AND slot_minutes > 0)
  )
);
CREATE TRIGGER condo_space_updated_at BEFORE UPDATE ON condo_space
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE condo_space IS 'Áreas comuns e suas regras configuráveis pelo síndico';

CREATE TABLE rules_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL,
  condo_space_id  uuid NOT NULL,
  file_url        text NOT NULL,
  file_size_bytes integer,                            -- "PDF · 180 KB"
  summary         text,                               -- "Resumo das regras" da tela de aceite
  version         integer NOT NULL,
  published_at    timestamptz NOT NULL DEFAULT now(),
  published_by    uuid NOT NULL,
  CONSTRAINT rules_document_version_uk UNIQUE (condo_space_id, version),
  CONSTRAINT rules_document_space_uk UNIQUE (id, condo_space_id),   -- alvo da FK do aceite
  CONSTRAINT rules_document_version_chk CHECK (version > 0),
  CONSTRAINT rules_document_space_fk FOREIGN KEY (condo_space_id, condominium_id) REFERENCES condo_space (id, condominium_id),
  CONSTRAINT rules_document_published_by_fk FOREIGN KEY (condominium_id, published_by) REFERENCES condominium_user (condominium_id, user_id)
);
COMMENT ON TABLE rules_document IS 'Versões do regulamento de cada área; a vigente é a de maior versão já publicada';

CREATE TABLE reservation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id    uuid NOT NULL,
  condo_space_id    uuid NOT NULL,
  unit_id           uuid NOT NULL,
  requested_by      uuid NOT NULL,
  start_datetime    timestamptz NOT NULL,
  end_datetime      timestamptz NOT NULL,             -- exclusivo: dia todo = [00:00, 00:00 do dia seguinte)
  period            tstzrange GENERATED ALWAYS AS (tstzrange(start_datetime, end_datetime, '[)')) STORED,
  status            reservation_status NOT NULL DEFAULT 'pending',
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  rejection_reason  text,
  canceled_at       timestamptz,
  canceled_by       uuid,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT reservation_space_uk UNIQUE (id, condo_space_id),      -- alvo da FK do aceite
  CONSTRAINT reservation_space_fk FOREIGN KEY (condo_space_id, condominium_id) REFERENCES condo_space (id, condominium_id),
  CONSTRAINT reservation_unit_fk FOREIGN KEY (unit_id, condominium_id) REFERENCES unit (id, condominium_id),
  CONSTRAINT reservation_requested_by_fk FOREIGN KEY (condominium_id, requested_by) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT reservation_reviewed_by_fk FOREIGN KEY (condominium_id, reviewed_by) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT reservation_canceled_by_fk FOREIGN KEY (condominium_id, canceled_by) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT reservation_period_chk CHECK (end_datetime > start_datetime),
  CONSTRAINT reservation_canceled_chk CHECK (
    status <> 'canceled' OR (canceled_at IS NOT NULL AND canceled_by IS NOT NULL)
  ),
  CONSTRAINT reservation_rejected_chk CHECK (
    status <> 'rejected' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL)
  ),
  -- Regra "Conflito de reserva": duas reservas ativas não se sobrepõem na mesma área.
  CONSTRAINT reservation_space_overlap_excl EXCLUDE USING gist (
    condo_space_id WITH =, period WITH &&
  ) WHERE (status IN ('pending', 'confirmed')),
  -- Tela de confirmação, erro "conflito": a unidade já tem reserva no mesmo período.
  CONSTRAINT reservation_unit_overlap_excl EXCLUDE USING gist (
    unit_id WITH =, period WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);
CREATE INDEX reservation_unit_active_idx ON reservation (unit_id, condo_space_id, start_datetime)
  WHERE status IN ('pending', 'confirmed');
CREATE INDEX reservation_requested_by_idx ON reservation (requested_by, start_datetime DESC);
CREATE INDEX reservation_pending_idx ON reservation (condominium_id, created_at) WHERE status = 'pending';
CREATE INDEX reservation_end_idx ON reservation (end_datetime) WHERE status = 'confirmed';   -- gatilho de preventivas
CREATE TRIGGER reservation_updated_at BEFORE UPDATE ON reservation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMENT ON TABLE reservation IS 'Reserva de área comum; cancelar muda o status e preserva o registro';

CREATE TABLE terms_acceptance (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id     uuid NOT NULL,
  reservation_id     uuid NOT NULL,
  rules_document_id  uuid NOT NULL,
  condo_space_id     uuid NOT NULL,                   -- garante que o regulamento é da mesma área da reserva
  user_id            uuid NOT NULL,
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_acceptance_reservation_uk UNIQUE (reservation_id),
  CONSTRAINT terms_acceptance_reservation_fk FOREIGN KEY (reservation_id, condominium_id) REFERENCES reservation (id, condominium_id),
  CONSTRAINT terms_acceptance_reservation_space_fk FOREIGN KEY (reservation_id, condo_space_id) REFERENCES reservation (id, condo_space_id),
  CONSTRAINT terms_acceptance_document_fk FOREIGN KEY (rules_document_id, condo_space_id) REFERENCES rules_document (id, condo_space_id),
  CONSTRAINT terms_acceptance_user_fk FOREIGN KEY (condominium_id, user_id) REFERENCES condominium_user (condominium_id, user_id)
);
CREATE INDEX terms_acceptance_document_idx ON terms_acceptance (rules_document_id);
COMMENT ON TABLE terms_acceptance IS 'Aceite do regulamento, preso à versão exata aceita';

-- Regra "Aceite do regulamento": se a área exige, a reserva só é gravada com aceite
-- na mesma transação (trigger adiado até o COMMIT).
CREATE FUNCTION reservation_require_terms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM condo_space s WHERE s.id = NEW.condo_space_id AND s.requires_terms)
     AND NOT EXISTS (SELECT 1 FROM terms_acceptance t WHERE t.reservation_id = NEW.id) THEN
    RAISE EXCEPTION 'A área exige aceite do regulamento para a reserva %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER reservation_require_terms
  AFTER INSERT ON reservation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION reservation_require_terms();

-- =====================================================================
-- Manutenção: cadastros de apoio
-- =====================================================================

CREATE TABLE maintenance_type (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL REFERENCES condominium (id),
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  CONSTRAINT maintenance_type_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT maintenance_type_name_uk UNIQUE (condominium_id, name)
);
COMMENT ON TABLE maintenance_type IS 'Tipos de manutenção (formulário, especialidades e filtro do histórico)';

CREATE TABLE maintenance_location (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL REFERENCES condominium (id),
  name            text NOT NULL,
  condo_space_id  uuid,
  is_active       boolean NOT NULL DEFAULT true,
  CONSTRAINT maintenance_location_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT maintenance_location_name_uk UNIQUE (condominium_id, name),
  CONSTRAINT maintenance_location_space_uk UNIQUE (condo_space_id),   -- CondoSpace 1 — 0..1 local
  CONSTRAINT maintenance_location_space_fk FOREIGN KEY (condo_space_id, condominium_id) REFERENCES condo_space (id, condominium_id)
);
COMMENT ON TABLE maintenance_location IS 'Locais que podem receber manutenção; liga à área reservável quando houver';

CREATE TABLE service_provider (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id        uuid NOT NULL REFERENCES condominium (id),
  kind                  provider_kind NOT NULL,
  name                  text NOT NULL,
  document              text,                         -- CNPJ/CPF (externo)
  job_title             text,                         -- função (funcionário)
  team_size             integer NOT NULL DEFAULT 1,   -- "Equipe de limpeza · Funcionários (3)"
  phone                 text,
  contract_type         provider_contract,
  contract_valid_until  date,
  shift                 employee_shift,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_provider_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT service_provider_team_size_chk CHECK (team_size >= 1),
  CONSTRAINT service_provider_external_chk CHECK (
    kind <> 'external' OR (job_title IS NULL AND shift IS NULL)
  ),
  CONSTRAINT service_provider_employee_chk CHECK (
    kind <> 'employee' OR (document IS NULL AND contract_type IS NULL AND contract_valid_until IS NULL)
  ),
  CONSTRAINT service_provider_contract_chk CHECK (
    contract_valid_until IS NULL OR contract_type IN ('monthly', 'semiannual_annual')
  )
);
-- O mesmo prestador pode atender vários condomínios, com um cadastro em cada.
CREATE UNIQUE INDEX service_provider_document_uk ON service_provider (condominium_id, document) WHERE document IS NOT NULL;
CREATE INDEX service_provider_contract_idx ON service_provider (condominium_id, contract_valid_until)
  WHERE contract_valid_until IS NOT NULL AND is_active;
COMMENT ON TABLE service_provider IS 'Prestadores externos e funcionários; nunca excluídos, apenas desativados';

CREATE TABLE service_provider_specialty (
  condominium_id       uuid NOT NULL,
  service_provider_id  uuid NOT NULL,
  maintenance_type_id  uuid NOT NULL,
  PRIMARY KEY (service_provider_id, maintenance_type_id),
  CONSTRAINT sps_provider_fk FOREIGN KEY (service_provider_id, condominium_id) REFERENCES service_provider (id, condominium_id),
  CONSTRAINT sps_type_fk FOREIGN KEY (maintenance_type_id, condominium_id) REFERENCES maintenance_type (id, condominium_id)
);
CREATE INDEX service_provider_specialty_type_idx ON service_provider_specialty (maintenance_type_id);

CREATE TABLE preventive_maintenance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id        uuid NOT NULL,
  name                  text NOT NULL,
  description           text,
  maintenance_type_id   uuid NOT NULL,
  location_id           uuid NOT NULL,
  trigger_type          preventive_trigger NOT NULL,
  frequency             preventive_frequency,
  first_run_date        date,
  run_time              time,                         -- "quintas às 7h"
  trigger_event         preventive_event,
  execution_window      preventive_window,
  default_provider_id   uuid,
  reminder_days_before  integer NOT NULL DEFAULT 2,   -- "O responsável recebe aviso 2 dias antes"
  next_run_at           timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preventive_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT preventive_type_fk FOREIGN KEY (maintenance_type_id, condominium_id) REFERENCES maintenance_type (id, condominium_id),
  CONSTRAINT preventive_location_fk FOREIGN KEY (location_id, condominium_id) REFERENCES maintenance_location (id, condominium_id),
  CONSTRAINT preventive_provider_fk FOREIGN KEY (default_provider_id, condominium_id) REFERENCES service_provider (id, condominium_id),
  CONSTRAINT preventive_created_by_fk FOREIGN KEY (condominium_id, created_by) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT preventive_recurring_chk CHECK (
    trigger_type <> 'recurring' OR (frequency IS NOT NULL AND first_run_date IS NOT NULL)
  ),
  CONSTRAINT preventive_event_chk CHECK (
    trigger_type <> 'event' OR (trigger_event IS NOT NULL AND execution_window IS NOT NULL)
  ),
  -- Na agenda, uma regra pausada aparece com responsável "a definir".
  CONSTRAINT preventive_active_provider_chk CHECK (NOT is_active OR default_provider_id IS NOT NULL),
  CONSTRAINT preventive_reminder_chk CHECK (reminder_days_before >= 0)
);
CREATE INDEX preventive_next_run_idx ON preventive_maintenance (next_run_at)
  WHERE is_active AND trigger_type = 'recurring';
CREATE INDEX preventive_event_idx ON preventive_maintenance (location_id, trigger_event)
  WHERE is_active AND trigger_type = 'event';
CREATE INDEX preventive_provider_idx ON preventive_maintenance (default_provider_id);
COMMENT ON TABLE preventive_maintenance IS 'Regra da agenda preventiva; cada execução gera uma incident com origin = preventive';

-- =====================================================================
-- Manutenção: ocorrências
-- =====================================================================

CREATE TABLE incident (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id             uuid NOT NULL,
  code                       text NOT NULL,           -- gerado pelo trigger: MNT-0001, por condomínio
  title                      text NOT NULL,
  description                text,
  location_id                uuid NOT NULL,
  maintenance_type_id        uuid NOT NULL,
  origin                     incident_origin NOT NULL,
  requested_by_user_id       uuid,
  unit_id                    uuid,
  preventive_maintenance_id  uuid,
  trigger_reservation_id     uuid,
  status                     incident_status NOT NULL,
  priority                   incident_priority,
  due_at                     timestamptz,
  assigned_provider_id       uuid,
  scheduled_start_at         timestamptz,
  scheduled_end_at           timestamptz,
  reviewed_by_user_id        uuid,
  reviewed_at                timestamptz,
  rejection_reason           incident_rejection,
  rejection_note             text,
  related_incident_id        uuid,
  started_at                 timestamptz,
  finished_at                timestamptz,
  cost                       numeric(12, 2),
  resident_rating            smallint,                -- "Você poderá avaliar o serviço"
  resident_feedback          text,
  rated_at                   timestamptz,
  created_by_user_id         uuid,                    -- síndico, nas avulsas
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_tenant_uk UNIQUE (id, condominium_id),
  CONSTRAINT incident_code_uk UNIQUE (condominium_id, code),
  CONSTRAINT incident_location_fk FOREIGN KEY (location_id, condominium_id) REFERENCES maintenance_location (id, condominium_id),
  CONSTRAINT incident_type_fk FOREIGN KEY (maintenance_type_id, condominium_id) REFERENCES maintenance_type (id, condominium_id),
  CONSTRAINT incident_unit_fk FOREIGN KEY (unit_id, condominium_id) REFERENCES unit (id, condominium_id),
  CONSTRAINT incident_preventive_fk FOREIGN KEY (preventive_maintenance_id, condominium_id) REFERENCES preventive_maintenance (id, condominium_id),
  CONSTRAINT incident_reservation_fk FOREIGN KEY (trigger_reservation_id, condominium_id) REFERENCES reservation (id, condominium_id),
  CONSTRAINT incident_provider_fk FOREIGN KEY (assigned_provider_id, condominium_id) REFERENCES service_provider (id, condominium_id),
  CONSTRAINT incident_related_fk FOREIGN KEY (related_incident_id, condominium_id) REFERENCES incident (id, condominium_id),
  CONSTRAINT incident_requested_by_fk FOREIGN KEY (condominium_id, requested_by_user_id) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT incident_reviewed_by_fk FOREIGN KEY (condominium_id, reviewed_by_user_id) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT incident_created_by_fk FOREIGN KEY (condominium_id, created_by_user_id) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT incident_title_chk CHECK (btrim(title) <> ''),
  CONSTRAINT incident_resident_origin_chk CHECK (
    origin <> 'resident' OR (requested_by_user_id IS NOT NULL AND unit_id IS NOT NULL)
  ),
  CONSTRAINT incident_preventive_origin_chk CHECK (
    (origin = 'preventive') = (preventive_maintenance_id IS NOT NULL)
  ),
  CONSTRAINT incident_trigger_reservation_chk CHECK (
    trigger_reservation_id IS NULL OR origin = 'preventive'
  ),
  CONSTRAINT incident_approved_chk CHECK (
    status NOT IN ('approved', 'in_progress', 'done')
    OR (priority IS NOT NULL AND assigned_provider_id IS NOT NULL AND due_at IS NOT NULL)
  ),
  CONSTRAINT incident_reviewed_chk CHECK (
    origin <> 'resident' OR status IN ('submitted', 'under_review')
    OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT incident_rejected_chk CHECK (
    status <> 'rejected'
    OR (rejection_reason IS NOT NULL AND rejection_note IS NOT NULL AND btrim(rejection_note) <> '')
  ),
  CONSTRAINT incident_already_scheduled_chk CHECK (
    rejection_reason IS DISTINCT FROM 'already_scheduled' OR related_incident_id IS NOT NULL
  ),
  CONSTRAINT incident_related_self_chk CHECK (related_incident_id <> id),
  CONSTRAINT incident_schedule_chk CHECK (
    scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at
  ),
  CONSTRAINT incident_started_chk CHECK (status NOT IN ('in_progress', 'done') OR started_at IS NOT NULL),
  CONSTRAINT incident_finished_chk CHECK (
    (status = 'done') = (finished_at IS NOT NULL) AND (finished_at IS NULL OR finished_at >= started_at)
  ),
  CONSTRAINT incident_cost_chk CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT incident_rating_chk CHECK (
    resident_rating IS NULL OR (resident_rating BETWEEN 1 AND 5 AND status = 'done' AND rated_at IS NOT NULL)
  )
);
-- Uma preventiva por evento gera no máximo uma ocorrência por reserva.
CREATE UNIQUE INDEX incident_preventive_reservation_uk ON incident (preventive_maintenance_id, trigger_reservation_id)
  WHERE trigger_reservation_id IS NOT NULL;
CREATE INDEX incident_status_idx ON incident (condominium_id, status, created_at DESC);
CREATE INDEX incident_requested_by_idx ON incident (requested_by_user_id, created_at DESC);
CREATE INDEX incident_location_idx ON incident (location_id, created_at DESC);
CREATE INDEX incident_type_idx ON incident (maintenance_type_id, created_at DESC);
CREATE INDEX incident_provider_open_idx ON incident (assigned_provider_id, scheduled_start_at)
  WHERE status NOT IN ('done', 'rejected');
CREATE INDEX incident_preventive_idx ON incident (preventive_maintenance_id);
CREATE INDEX incident_finished_idx ON incident (condominium_id, finished_at) WHERE status = 'done';
COMMENT ON TABLE incident IS 'Ocorrência de manutenção (morador, avulsa ou preventiva); base do painel, histórico e escala';

CREATE TABLE incident_status_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id      uuid NOT NULL,
  incident_id         uuid NOT NULL,
  status              incident_status NOT NULL,
  note                text,
  changed_by_user_id  uuid,                           -- nulo quando feito pelo sistema
  changed_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ish_incident_fk FOREIGN KEY (incident_id, condominium_id) REFERENCES incident (id, condominium_id),
  CONSTRAINT ish_changed_by_fk FOREIGN KEY (condominium_id, changed_by_user_id) REFERENCES condominium_user (condominium_id, user_id)
);
CREATE INDEX incident_status_history_incident_idx ON incident_status_history (incident_id, changed_at);
COMMENT ON TABLE incident_status_history IS 'Linha do tempo exibida ao morador; gravada pelo trigger de incident';

CREATE TABLE incident_attachment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id       uuid NOT NULL,
  incident_id          uuid NOT NULL,
  file_url             text NOT NULL,
  uploaded_by_user_id  uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ia_incident_fk FOREIGN KEY (incident_id, condominium_id) REFERENCES incident (id, condominium_id),
  CONSTRAINT ia_uploaded_by_fk FOREIGN KEY (condominium_id, uploaded_by_user_id) REFERENCES condominium_user (condominium_id, user_id)
);
CREATE INDEX incident_attachment_incident_idx ON incident_attachment (incident_id);

-- Validação da ocorrência: protocolo por condomínio e imutável, transições de status,
-- prazo pela prioridade e prestador ativo que atende o tipo.
CREATE FUNCTION incident_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_number integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.origin = 'resident' AND NEW.status <> 'submitted' THEN
      RAISE EXCEPTION 'Ocorrência aberta por morador nasce como submitted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origin IN ('manual', 'preventive') AND NEW.status <> 'approved' THEN
      RAISE EXCEPTION 'Ocorrência % nasce como approved', NEW.origin USING ERRCODE = 'check_violation';
    END IF;
    -- O UPDATE trava a linha do condomínio e serializa a numeração entre transações.
    UPDATE condominium SET last_incident_number = last_incident_number + 1
     WHERE id = NEW.condominium_id
    RETURNING last_incident_number INTO v_number;
    NEW.code := 'MNT-' || CASE WHEN v_number < 10000 THEN lpad(v_number::text, 4, '0') ELSE v_number::text END;
  ELSE
    IF NEW.code <> OLD.code OR NEW.condominium_id <> OLD.condominium_id THEN
      RAISE EXCEPTION 'Protocolo e condomínio da ocorrência % não podem mudar', OLD.code USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
         ('submitted',    'under_review'),
         ('submitted',    'rejected'),
         ('under_review', 'approved'),
         ('under_review', 'rejected'),
         ('approved',     'in_progress'),
         ('in_progress',  'done')
       ) THEN
      RAISE EXCEPTION 'Transição de status não permitida: % → %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Prazo pela prioridade (Alta 48 h, Média 5 dias, Baixa 15 dias), se a aplicação não informou.
  -- Preventivas por evento informam due_at pela janela de execução.
  IF NEW.priority IS NOT NULL AND NEW.due_at IS NULL
     AND NEW.status IN ('approved', 'in_progress', 'done') THEN
    NEW.due_at := now() + CASE NEW.priority
                            WHEN 'high'   THEN interval '48 hours'
                            WHEN 'medium' THEN interval '5 days'
                            ELSE               interval '15 days'
                          END;
  END IF;

  IF NEW.assigned_provider_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.assigned_provider_id IS DISTINCT FROM OLD.assigned_provider_id
          OR NEW.maintenance_type_id <> OLD.maintenance_type_id) THEN
    IF NOT EXISTS (SELECT 1 FROM service_provider p WHERE p.id = NEW.assigned_provider_id AND p.is_active) THEN
      RAISE EXCEPTION 'Prestador inativo não pode receber ocorrências' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM service_provider_specialty sps
                   WHERE sps.service_provider_id = NEW.assigned_provider_id
                     AND sps.maintenance_type_id = NEW.maintenance_type_id) THEN
      RAISE EXCEPTION 'O prestador não atende o tipo de manutenção da ocorrência' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER incident_before_write BEFORE INSERT OR UPDATE ON incident
  FOR EACH ROW EXECUTE FUNCTION incident_before_write();

-- Toda mudança de status entra na linha do tempo. A aplicação informa quem mudou e o texto
-- da etapa na transação (app.status_note vale até o fim da transação: redefina a cada mudança):
--   SET LOCAL app.current_user_id = '<uuid>';
--   SET LOCAL app.status_note = 'Prioridade alta. Responsável: Hidráulica Ramos.';
CREATE FUNCTION incident_log_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status THEN
    -- clock_timestamp(): várias mudanças na mesma transação ficam em ordem (now() seria igual para todas).
    INSERT INTO incident_status_history (condominium_id, incident_id, status, note, changed_by_user_id, changed_at)
    VALUES (NEW.condominium_id,
            NEW.id,
            NEW.status,
            NULLIF(current_setting('app.status_note', true), ''),
            NULLIF(current_setting('app.current_user_id', true), '')::uuid,
            clock_timestamp());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER incident_log_status AFTER INSERT OR UPDATE OF status ON incident
  FOR EACH ROW EXECUTE FUNCTION incident_log_status();

-- Preventiva: responsável ativo; por evento, o local precisa ser uma área reservável.
CREATE FUNCTION preventive_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trigger_type = 'event' AND NOT EXISTS (
       SELECT 1 FROM maintenance_location l WHERE l.id = NEW.location_id AND l.condo_space_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Preventiva por evento exige local ligado a uma área reservável' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.default_provider_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.default_provider_id IS DISTINCT FROM OLD.default_provider_id)
     AND NOT EXISTS (SELECT 1 FROM service_provider p WHERE p.id = NEW.default_provider_id AND p.is_active) THEN
    RAISE EXCEPTION 'Prestador inativo não pode ser responsável de preventiva' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preventive_before_write BEFORE INSERT OR UPDATE ON preventive_maintenance
  FOR EACH ROW EXECUTE FUNCTION preventive_before_write();

-- =====================================================================
-- Bloqueio de áreas (depois de incident, pois pode apontar a manutenção que o motivou)
-- =====================================================================

CREATE TABLE space_block (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL,
  condo_space_id  uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text NOT NULL,
  incident_id     uuid,                               -- bloqueio por manutenção (selo "Manutenção" no admin)
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_block_space_fk FOREIGN KEY (condo_space_id, condominium_id) REFERENCES condo_space (id, condominium_id),
  CONSTRAINT space_block_incident_fk FOREIGN KEY (incident_id, condominium_id) REFERENCES incident (id, condominium_id),
  CONSTRAINT space_block_created_by_fk FOREIGN KEY (condominium_id, created_by) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT space_block_period_chk CHECK (ends_at > starts_at)
);
CREATE INDEX space_block_space_period_idx ON space_block USING gist (condo_space_id, tstzrange(starts_at, ends_at, '[)'));
COMMENT ON TABLE space_block IS 'Bloqueios temporários da área (manutenção, evento, dedetização)';

-- =====================================================================
-- Notificações (os dois módulos avisam morador, síndico e prestador)
-- =====================================================================

CREATE TABLE notification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id  uuid NOT NULL,
  user_id         uuid NOT NULL,
  kind            text NOT NULL,                       -- ex.: incident_rejected, reservation_confirmed
  title           text NOT NULL,
  body            text,
  incident_id     uuid,
  reservation_id  uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_user_fk FOREIGN KEY (condominium_id, user_id) REFERENCES condominium_user (condominium_id, user_id),
  CONSTRAINT notification_incident_fk FOREIGN KEY (incident_id, condominium_id) REFERENCES incident (id, condominium_id),
  CONSTRAINT notification_reservation_fk FOREIGN KEY (reservation_id, condominium_id) REFERENCES reservation (id, condominium_id)
);
CREATE INDEX notification_user_unread_idx ON notification (user_id, created_at DESC) WHERE read_at IS NULL;

COMMIT;
