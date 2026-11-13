from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.router import router as core_router
from app.errors import register_error_handlers
from app.manutencao.router import router as manutencao_router
from app.reservas.router import router as reservas_router

DESCRIPTION = """
API da POC do CondoHub: **reserva de áreas comuns** e **manutenção**.

- Todas as rotas de dados ficam sob `/condominiums/{condominium_id}`.
- **Sem autenticação.** O usuário que está agindo vai no cabeçalho `X-User-Id` (simulação da POC).
  Rotas que gravam autor (abrir solicitação, aprovar, reservar...) exigem esse cabeçalho.
- Erros sempre no formato `{"error": {"code": "...", "message": "..."}}`. Use o `code` para escolher a tela.
- Datas e horas em ISO 8601 com fuso. O condomínio de demonstração usa `America/Sao_Paulo`.
"""

app = FastAPI(title="CondoHub API", version="0.1.0", description=DESCRIPTION)

# POC: frontend em outra origem durante o desenvolvimento.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

register_error_handlers(app)
app.include_router(core_router)
app.include_router(reservas_router)
app.include_router(manutencao_router)


@app.get("/health", tags=["Sistema"], summary="Verificação de saúde")
def health():
    return {"status": "ok"}
