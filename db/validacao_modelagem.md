# Validação da modelagem × designs

Confronto entre `modelagem_dados_fluxo_reserva.xlsx`, `modelagem_dados_fluxo_manutencao.md` e as telas dos artefatos **CondoHub - Fluxo de Reserva** (10 telas) e **CondoHub - Fluxo Manutenção** (8 telas). O DDL resultante está em `db/01_schema.sql`.

## 1. Convenções adotadas no DDL

| Tema | Modelagem | DDL |
|---|---|---|
| Nomes | `.md` em camelCase (`Incident`, `locationId`); `.xlsx` em snake_case | snake_case em tudo (`incident.location_id`). `User` → `app_user` (`user` é palavra reservada) |
| Enums | `.md` em MAIÚSCULAS (`SUBMITTED`); `.xlsx` em minúsculas (`pending`) | `CREATE TYPE … AS ENUM` em minúsculas nos dois fluxos (`submitted`, `pending`) |
| `id` | `uuid` | `uuid DEFAULT gen_random_uuid()` |
| `datetime` | — | `timestamptz`; banco em `America/Sao_Paulo` |
| Dia todo | `end_datetime` = 23:59 | intervalo semiaberto `[00:00, 00:00 do dia seguinte)`: sem o “minuto perdido” e compatível com o `EXCLUDE` |
| Condomínio | não modelado | Multicondomínio desde já (ver seção 1.1), operando inicialmente com um só |

### 1.1 Multicondomínio

- Nova tabela `condominium` (nome, CNPJ, administradora, fuso, contador de protocolo).
- Todas as tabelas de dados têm `condominium_id`. As FKs são compostas `(x_id, condominium_id)`, então o banco impede, por exemplo, que uma reserva do condomínio A use uma unidade do condomínio B.
- `app_user` virou identidade global (nome, e-mail, conta ativa). O papel (`role`) e a situação no condomínio (`is_active`) foram para `condominium_user`, porque a mesma pessoa pode ser síndica em um condomínio e moradora em outro. Toda coluna que aponta para usuário referencia `condominium_user`, o que garante que a pessoa participa daquele condomínio.
- A pendência financeira é da **unidade**: `unit.inadimplente` (migração `0002`). Antes era `condominium_user.has_pending_dues` e só bloqueava áreas com `condo_space.block_if_pending`; agora bloqueia a reserva de todos os moradores da unidade, em qualquer área, e as duas colunas antigas saíram.
- Tipos de manutenção, locais e prestadores são cadastrados por condomínio, e os nomes são únicos dentro de cada um.
- O protocolo `MNT-0001` é numerado por condomínio (`condominium.last_incident_number`) e é único por `(condominium_id, code)`.
- O isolamento nas consultas fica com a aplicação, que filtra por `condominium_id`. Se quiser essa garantia no banco, o próximo passo é ativar RLS com `current_setting('app.condominium_id')`.

## 2. Lacunas nas modelagens (já incluídas no DDL)

### Reserva
| Tela | O que a tela mostra | Acréscimo |
|---|---|---|
| Áreas comuns | Capacidade (“Até 80 pessoas”) e ícone por área | `condo_space.capacity`, `condo_space.icon` |
| Calendário | Navegação limitada a 3 meses à frente | `condo_space.booking_horizon_days` (padrão 90) |
| Aceite das regras | “Resumo das regras” e “PDF · 180 KB” | `rules_document.summary`, `rules_document.file_size_bytes` |
| Confirmação | Status “Pendente de aprovação” → a administração aprova ou recusa | `reservation.reviewed_by`, `reviewed_at`, `rejection_reason` (o status `rejected` existia, mas sem quem e por quê) |
| Confirmação (erro “conflito”) | “Você já tem uma reserva sua no mesmo período” | `EXCLUDE` também por `unit_id` (em qualquer área) |
| Detalhes da reserva | Editar e cancelar | `reservation.updated_at`, `canceled_by` |
| Admin — áreas | Selo “Manutenção” na Piscina | `space_block.incident_id` liga o bloqueio à ocorrência; `space_block.created_by` |
| Início / admin | Área do administrador | `role` ganhou `admin`; `proprietário` saiu de `role` porque já está em `unit_resident.relation` (um síndico também pode ser morador) |

### Manutenção
| Tela | O que a tela mostra | Acréscimo |
|---|---|---|
| Acompanhar | “Você poderá avaliar o serviço quando for finalizado” | `incident.resident_rating` (1–5), `resident_feedback`, `rated_at` |
| Painel → Agendar manutenção | Síndico cria avulsa | `incident.created_by_user_id` |
| Prestadores | “Equipe de limpeza · Funcionários (3)” | `service_provider.team_size` |
| Agenda preventiva | “Semanal, quintas às 7h” | `preventive_maintenance.run_time` (o `.md` só tinha data) |
| Agenda preventiva | “O responsável recebe aviso 2 dias antes” | `preventive_maintenance.reminder_days_before` |
| Agenda preventiva | Regra pausada com responsável “a definir” | `default_provider_id` passou a ser opcional, mas é obrigatório quando `is_active` |
| As duas jornadas | “O síndico foi notificado”, banner de recusa, “Você receberá uma notificação” | Tabela `notification` |

## 3. Inconsistências nos designs (corrigir nas telas)

1. **Nomes dos tipos de manutenção diferem entre as telas.** Nova solicitação: “Portões e acesso”, “Elevador”, “Estrutura e pintura”. Prestadores: “Portões”, “Elevadores”, “Pintura”. Histórico: “Estrutura”, “Elevadores”. O formulário do morador também não tem “Ar-condicionado” nem “Piscina”, que aparecem nas outras telas. O seed usa a lista canônica do `.md` (10 tipos).
2. **Nomes dos locais variam.** “Elevador · Bloco A” (painel), “Elevador social · Bloco B” (formulário) e “Elevadores” (histórico) são formas diferentes de citar os elevadores. “Academia” aparece no histórico e na agenda, mas não no formulário.
3. **Espaço gourmet** é “por horário, blocos de 3h” no admin e no calendário, mas aparece como “Dia todo” em *Minhas reservas*.
4. **Grade da quadra**: 07h–22h em blocos de 2h dá 07, 09, 11, 13…, mas o calendário mostra 07, 09, 11, **14**, 16… Se existe intervalo de almoço, ele não está modelado.
5. **Uma regra para várias áreas.** Na agenda, “Limpeza pós-reserva” vale para salão, churrasqueira e espaço gourmet, mas o formulário de nova regra escolhe **um** local. O DDL segue o `.md` e o formulário (um local por regra), então essa regra vira três registros.
6. **Prestador sem a especialidade.** Carlos Souza aparece como responsável pela “Manutenção da churrasqueira” (tipo Limpeza no histórico), mas as especialidades dele são hidráulica, portões e piscina. O trigger do banco rejeita essa atribuição.

## 4. Conflitos entre design e regras

### Decididos
1. **Aprovar direto de “Nova”**: vale o `.md`. `submitted` só vai para `under_review` ou `rejected`. Ao abrir a solicitação no painel, a aplicação a move para `under_review`.
2. **“Desfazer” a decisão**: fica na interface. O banco só recebe a decisão final, e `done`/`rejected` continuam finais.
3. **Nome `incident`**: reserva e manutenção são módulos da mesma aplicação, e o bloco “Ocorrências” da home é o módulo de manutenção. O nome da tabela fica.
4. **`move_completed`**: fica no enum e será resolvido no desenvolvimento da aplicação.

### Em aberto
1. **Custo no histórico.** A coluna mostra “R$ valor”, “interno” ou “contrato”. O `.md` só tem `cost`. Hoje isso pode ser derivado do prestador (funcionário → interno; contrato mensal ou semestral → contrato), mas a classificação muda se o contrato do prestador mudar. Se o histórico precisar ser fiel, crie um `cost_type` na ocorrência.
2. **Escala do prestador.** O `.md` define a escala como “ocorrências não finalizadas atribuídas a ele”, mas a tela também lista regras recorrentes (“Tratamento da água · Preventiva semanal · quintas”). A consulta da escala precisa unir `incident` e `preventive_maintenance.default_provider_id`.
3. **“Corretiva” × origem.** O histórico divide em Preventiva/Corretiva (“abertas por moradores”), mas existem três origens. Defina se `manual` conta como corretiva.

## 5. Fora do escopo das duas modelagens (citado nas telas)

- **Mensagens** (“Enviar mensagem ao síndico”, “Contestar com o síndico”).
- Encomendas, Financeiro e Comunicados (`unit.inadimplente` é só um indicador; o preenchimento automático da flag fica para depois).
- Taxa por cancelamento com menos de 48h (“Cancelamento sem custo até 48h antes”).

## 6. Onde cada regra é garantida

| Regra | Banco | Backend |
|---|---|---|
| Duas reservas ativas sem sobreposição na mesma área | `EXCLUDE USING gist` | — |
| A unidade não tem duas reservas no mesmo período | `EXCLUDE USING gist` | — |
| Aceite obrigatório quando a área exige | Trigger de restrição adiado até o COMMIT | Inserir reserva e aceite na mesma transação |
| Aceite aponta para regulamento da mesma área | FK composta `(id, condo_space_id)` | Escolher a versão vigente |
| Modo por horário exige abertura, fechamento e duração | `CHECK` | Validar se a reserva cabe na grade |
| Limite de reservas futuras por unidade | — | `SELECT … FOR UPDATE` / contagem na transação |
| Usuário ativo e vinculado à unidade; unidade sem inadimplência (`unit.inadimplente`) | — | Validar antes de reservar (`check_user_can_book` → `check_unit_not_delinquent`, 403 `pending_dues`) |
| Transições de status da ocorrência | Trigger `incident_before_write` | — |
| Aprovar exige prioridade e responsável; o prazo vem da prioridade | `CHECK` + trigger preenche `due_at` | Preventiva por evento informa `due_at` pela janela |
| Recusar exige motivo e justificativa; `already_scheduled` exige a ocorrência relacionada | `CHECK` | — |
| Prestador ativo e com a especialidade | Trigger | — |
| Protocolo único por condomínio e imutável | `UNIQUE (condominium_id, code)` + contador em `condominium` + trigger | — |
| Linha do tempo a cada mudança de status | Trigger `incident_log_status` | `SET LOCAL app.current_user_id` e `app.status_note` |
| Uma ocorrência por reserva em cada preventiva por evento | Índice único parcial | — |
| Preventiva por evento só em área reservável | Trigger | — |
| Morador vê só as próprias ocorrências | — | Filtro por `requested_by_user_id` (ou RLS, se quiser no banco) |
