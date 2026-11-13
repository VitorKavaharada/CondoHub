-- CondoHub — criação do banco (PostgreSQL 15+)
-- Rodar conectado ao banco "postgres" (CREATE DATABASE não roda dentro de transação):
--   psql -d postgres -f db/00_create_database.sql
-- Depois:
--   psql -d condohub -f db/01_schema.sql
--   psql -d condohub -f db/02_seed.sql   (opcional, dados do protótipo)
--
-- A ordenação em português vem do ICU (pt-BR), sem depender da locale pt_BR estar
-- gerada no sistema operacional.

CREATE DATABASE condohub
  WITH ENCODING 'UTF8'
       LOCALE_PROVIDER icu
       ICU_LOCALE 'pt-BR'
       LOCALE 'C.UTF-8'
       TEMPLATE template0;

ALTER DATABASE condohub SET timezone TO 'America/Sao_Paulo';
