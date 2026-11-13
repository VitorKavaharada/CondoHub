# CondoHub — Frontend

App web dos módulos de **reserva de áreas comuns** e **manutenção**, feito a partir dos designs "CondoHub - Acesso à Reserva" e "CondoHub - Fluxo Manutenção" e ligado à API em `api/`. As telas do morador são mobile first; as do síndico para manutenção são um painel web de desktop.

HTML, CSS e JavaScript puros (módulos ES): não precisa de Node, `npm install` nem build. Basta servir a pasta `frontend/` por HTTP.

## Telas

### Manutenção

| Rota | Tela do design |
|---|---|
| `#/manutencao` | Morador — minhas manutenções (em andamento e finalizadas, aviso de recusa) |
| `#/manutencao/nova` | Morador — abrir solicitação |
| `#/manutencao/{id}` | Morador — acompanhar status (linha do tempo, avaliação) e solicitação recusada |
| `#/sindico/manutencoes` | Web — painel: indicadores, filtros, CSV, aprovar/recusar, iniciar e concluir, agendar avulsa |
| `#/sindico/prestadores` | Web — prestadores e equipe: lista, escala e cadastro |
| `#/sindico/historico` | Web — histórico por local ou tipo |
| `#/sindico/preventivas` | Web — agenda do mês e regras preventivas (criar, pausar, gerar agora) |

Ao abrir uma solicitação nova no painel, o front chama `POST /incidents/{id}/review`, que a coloca "em análise", como pede a documentação da API.

### Reservas

| Rota | Tela do design |
|---|---|
| `#/` | Início — acesso à reserva |
| `#/areas` | Áreas comuns — seleção |
| `#/reservar/{área}` | Data e horário (por horário) ou Data — dia inteiro |
| `#/reservar/{área}/regras` | Aceite das regras |
| `#/confirmar` | Confirmar reserva (resumo, envio, sucesso e erros por `code`) |
| `#/reservas` | Minhas reservas |
| `#/reservas/{id}` | Detalhes da reserva (editar e cancelar) |
| `#/admin/areas` | Admin — gerenciar áreas e aprovar/recusar solicitações |
| `#/admin/areas/{id}` | Admin — editar área e regras (`nova` cadastra uma área) |
| `#/notificacoes` | Notificações do usuário |
| `#/perfil` | Troca do usuário simulado (`X-User-Id`) e da conexão com a API |

## Como rodar

1. Suba a API (veja o README da raiz): `uv run uvicorn app.main:app --reload --port 8000`
2. Sirva esta pasta, por exemplo:

```bash
cd frontend
python3 -m http.server 5173
```

3. Abra http://localhost:5173

A API já libera CORS para qualquer origem, então o front pode rodar em outra porta.

### Sem API: dados de demonstração

Abra http://localhost:5173/?mock=1 (ou ligue **Dados de demonstração** em Perfil). O app passa a usar uma API simulada no navegador (`src/mock.js`), com as mesmas rotas, regras e códigos de erro da API real e os dados de `db/02_seed.sql` e `db/03_demo.sql`. Os dados ficam na aba até ela ser fechada; Perfil › **Restaurar dados de demonstração** volta ao estado inicial.

## Configuração

Padrões em `src/config.js`, que podem ser trocados na tela Perfil ou pela URL:

| Parâmetro | Padrão |
|---|---|
| `?api=` | `http://localhost:8000` |
| `?user=` | `aaaaaaaa-0000-0000-0000-000000000001` (Aline Costa) |
| `?condominium=` | `11111111-1111-1111-1111-111111111111` |
| `?mock=1` | desligado |

Para testar a área do administrador, escolha **Roberto Mendes** (síndico) em Perfil. **Paula Rocha** mora numa unidade inadimplente: veja abaixo.

## Bloqueio por inadimplência

Quando todas as unidades do usuário estão inadimplentes (`GET /me` → `units[].inadimplente`):

- a home mostra o aviso "Reserva bloqueada" e o atalho **Reserva de espaço** abre o modal de bloqueio;
- áreas, data/horário, regras e confirmação abrem o mesmo modal (inclusive por link direto), com o botão de continuar desativado. O modal só sai pelos botões ("Voltar ao início" ou "Ver minhas reservas");
- se a unidade ficar inadimplente com o fluxo já aberto, a API recusa com `403 pending_dues` e a confirmação mostra o modal, sem criar a reserva;
- editar uma reserva de unidade inadimplente também abre o modal.

Quem tem mais de uma unidade escolhe na confirmação; a unidade inadimplente aparece marcada "com pendência" e não pode ser usada.

## Integração com a API e feedback

- **Persistência real:** todas as telas leem e gravam pela API; os dados simulados só entram com `?mock=1`.
- **Carregamento:** listas (minhas reservas, áreas, manutenções) mostram esqueleto enquanto carregam; botões que gravam mostram spinner e ficam desativados; a confirmação da reserva tem a etapa "Enviando".
- **Listas sempre atualizadas:** depois de reservar ou abrir um chamado, o app leva para a lista com o item novo destacado. As listas de reservas, manutenções, o detalhe e o painel do síndico se atualizam sozinhos (a cada 10–30 s, quando a aba volta a ficar visível e logo depois de qualquer gravação), então aprovações e mudanças de status aparecem sem recarregar a página.
- **Erros:** os códigos da API viram mensagens amigáveis (ex.: `slot_taken` → "Este horário já foi reservado", com opção de escolher outro). Queda de rede, tempo esgotado (20 s) e erro 5xx também viram mensagem em português com "Tentar novamente". Uma falha inesperada mostra aviso, sem deixar a tela em branco.
- **Toasts:** verde para sucesso, vermelho para erro (`toast.success` / `toast.error` em `ui.js`).

## Estrutura

```
frontend/
├── index.html
├── styles.css          tokens e componentes visuais do design
├── maintenance.css     telas de manutenção e painel web do síndico
└── src/
    ├── main.js         roteador por hash
    ├── api.js          cliente da API (X-User-Id, erros {code, message}, timeout, evento condohub:changed)
    ├── delinquency.js  regra de inadimplência no fluxo de reserva (aviso e modal de bloqueio)
    ├── mock.js         API simulada para o modo demonstração (reservas)
    ├── mock-maintenance.js  API simulada: manutenção, prestadores e preventivas
    ├── config.js       endereço da API, condomínio e usuário
    ├── draft.js        reserva em andamento (sessionStorage)
    ├── format.js       datas em pt-BR no fuso do condomínio
    ├── html.js         template de HTML com escape automático
    ├── icons.js        ícones de traço do design
    ├── ui.js           peças compartilhadas (cabeçalho, estados, menu, modal, toasts, esqueleto, autoRefresh)
    └── views/          uma tela por arquivo (manutenção em views/maintenance/)
```
