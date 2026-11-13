# CondoHub

Aplicação de gestão de condomínio. Esta etapa traz o banco de dados e a API (POC) dos módulos de **reserva de áreas comuns** e **manutenção**.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `db/00_create_database.sql` | Cria o banco `condohub` |
| `db/01_schema.sql` | Tabelas, enums, constraints e triggers |
| `db/02_seed.sql` | Condomínio, áreas, tipos de manutenção e locais dos protótipos |
| `db/03_demo.sql` | Dados de demonstração: pessoas, unidades, prestadores, regulamentos e regras preventivas |
| `db/validacao_modelagem.md` | Validação das modelagens contra os designs e decisões tomadas |
| `api/` | API em Python (FastAPI) |

## Criação do banco de dados

Requisitos: PostgreSQL 15 ou superior (o banco usa collation ICU `pt-BR`). Os passos abaixo são para Debian/Ubuntu, inclusive no WSL.

### 1. Instalar o PostgreSQL

```bash
sudo apt-get update
sudo apt-get install -y postgresql
```

No Debian 13 isso instala o PostgreSQL 17 e já inicia o serviço. Para conferir:

```bash
sudo systemctl status postgresql      # sem systemd no WSL: sudo service postgresql status
```

### 2. Criar um usuário do banco para o seu login

O PostgreSQL vem só com o superusuário `postgres`. Crie um papel com o mesmo nome do seu usuário Linux, para usar o `psql` sem `sudo`:

```bash
sudo -u postgres createuser --superuser "$USER"
```

### 3. Criar o banco, as tabelas e os dados iniciais

Na raiz do repositório:

```bash
psql -d postgres -v ON_ERROR_STOP=1 -f db/00_create_database.sql
psql -d condohub -v ON_ERROR_STOP=1 -f db/01_schema.sql
psql -d condohub -v ON_ERROR_STOP=1 -f db/02_seed.sql
psql -d condohub -v ON_ERROR_STOP=1 -f db/03_demo.sql   # opcional, dados para a POC
```

`00` cria o banco `condohub` (UTF-8, ordenação pt-BR, fuso `America/Sao_Paulo`). `01` cria o esquema numa única transação: se algo falhar, nada fica pela metade. `02` cadastra o condomínio "Residencial Jardins" com as áreas, os tipos de manutenção e os locais dos protótipos. `03` acrescenta pessoas, prestadores e regras para usar a API.

Depois, marque o banco como migrado no Alembic (passo 2 da seção da API). As próximas mudanças de esquema serão migrações do Alembic.

> **Já tinha o banco criado antes?** Não precisa recriar: rode `uv run alembic upgrade head` na pasta `api/` para aplicar as migrações novas (por exemplo, a `0002`, que leva a inadimplência para a unidade).

### 4. Conferir

```bash
psql -d condohub -c '\dt'
psql -d condohub -c 'SELECT name, booking_mode FROM condo_space ORDER BY name;'
```

### Recriar do zero

```bash
psql -d postgres -c 'DROP DATABASE IF EXISTS condohub;'
```

Em seguida, repita o passo 3.

### Conexão por TCP

A API usa o socket local por padrão e não precisa de senha. Para conectar por `localhost:5432` (outra ferramenta, outro computador), defina uma senha para o seu papel:

```bash
psql -d postgres -c "ALTER ROLE \"$USER\" PASSWORD 'troque-esta-senha';"
```

String de conexão: `postgresql://<usuario>:<senha>@localhost:5432/condohub`

## API

FastAPI + SQLAlchemy 2 (síncrono) + psycopg 3, com dependências gerenciadas pelo [uv](https://docs.astral.sh/uv/).

### 1. Instalar o uv

```bash
sudo apt-get install -y curl ca-certificates
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
```

### 2. Instalar as dependências e preparar o banco

```bash
cd api
uv sync
uv run alembic stamp head        # banco criado agora pelo psql (seção anterior)
```

O `01_schema.sql` já traz o esquema da versão mais recente, por isso um banco novo é marcado com `stamp head`. Para um banco criado com uma versão anterior do repositório, use `uv run alembic upgrade head`: as migrações são idempotentes e migram os dados.

Num banco vazio, `uv run alembic upgrade head` cria o esquema no lugar do `01_schema.sql`. Os dados iniciais (`02` e `03`) continuam sendo carregados pelo `psql`.

A conexão vem da variável `CONDOHUB_DATABASE_URL` (padrão `postgresql+psycopg:///condohub`). Veja `api/.env.example`.

### 3. Subir a API

```bash
uv run uvicorn app.main:app --reload --port 8000
```

- Documentação interativa: http://localhost:8000/docs
- Contrato OpenAPI para o frontend: http://localhost:8000/openapi.json

### 4. Rodar os testes

```bash
uv run pytest
```

Os testes recriam o banco `condohub_test` a partir de `db/01`, `02` e `03` e não tocam no `condohub`.

### Como usar

- **Sem login.** O usuário que está agindo vai no cabeçalho `X-User-Id`. Rotas que gravam autor (reservar, abrir solicitação, aprovar…) exigem esse cabeçalho. Ids de demonstração:

  | Pessoa | Papel | X-User-Id |
  |---|---|---|
  | Aline Costa (Apto 302 B) | moradora | `aaaaaaaa-0000-0000-0000-000000000001` |
  | Roberto Mendes | síndico | `aaaaaaaa-0000-0000-0000-000000000002` |
  | Marcos Lima (Apto 104 A) | morador | `aaaaaaaa-0000-0000-0000-000000000003` |
  | Paula Rocha (Apto 210 A) | moradora de unidade **inadimplente** | `aaaaaaaa-0000-0000-0000-000000000004` |

- Todas as rotas de dados ficam sob `/condominiums/{condominium_id}`. Condomínio de demonstração: `11111111-1111-1111-1111-111111111111`.
- Erros sempre no formato `{"error": {"code": "slot_taken", "message": "Este horário já foi reservado"}}`. O `code` é estável e serve para escolher a tela; a lista de cada rota está na documentação.
- Fotos e PDFs entram como endereço (`file_url`); o upload de arquivos fica fora da POC.
- A geração das manutenções preventivas roda por `POST /condominiums/{id}/jobs/preventive-maintenance/run`. O parâmetro `now` permite simular uma data.

### Inadimplência

A flag `inadimplente` fica na tabela `unit` (unidade), não na pessoa: quando ela está ligada, **nenhum morador da unidade** consegue reservar áreas comuns, em qualquer área.

- `POST /reservations` verifica a inadimplência antes de qualquer outra regra e responde `403` com `{"error": {"code": "pending_dues", ...}}`. Nada é gravado.
- `PATCH /reservations/{id}` (mudar data/horário) também é bloqueado. Cancelar continua permitido.
- `GET /me` e `GET /units` devolvem `inadimplente` em cada unidade; `has_pending_dues` em `/me` indica se alguma unidade da pessoa está inadimplente.

Ainda não há rota nem integração para preencher a flag (fica para uma etapa posterior). Para testar, altere direto no banco:

```bash
psql -d condohub -c "UPDATE unit SET inadimplente = true  WHERE code = '302' AND block = 'B';"   # bloqueia
psql -d condohub -c "UPDATE unit SET inadimplente = false WHERE code = '302' AND block = 'B';"   # libera
```

Exemplo:

```bash
C=/condominiums/11111111-1111-1111-1111-111111111111
curl -H 'X-User-Id: aaaaaaaa-0000-0000-0000-000000000001' localhost:8000$C/me
curl "localhost:8000$C/spaces"
```
