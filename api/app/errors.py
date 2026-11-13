"""Erros da API e tradução das violações de regra do banco em respostas HTTP.

Toda resposta de erro tem o formato:
    {"error": {"code": "slot_taken", "message": "Este horário já foi reservado"}}
O `code` é estável e é o que o frontend usa para escolher a tela/mensagem.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


class NotFound(AppError):
    def __init__(self, what: str):
        super().__init__(404, "not_found", f"Não encontrado: {what}")


# Nome da constraint → (status HTTP, code, mensagem)
CONSTRAINTS: dict[str, tuple[int, str, str]] = {
    "reservation_space_overlap_excl": (409, "slot_taken", "Este horário já foi reservado"),
    "reservation_unit_overlap_excl": (409, "unit_conflict", "A unidade já tem uma reserva no mesmo período"),
    "terms_acceptance_document_fk": (422, "terms_outdated", "O regulamento aceito não é desta área"),
    "condo_space_name_uk": (409, "duplicate_name", "Já existe uma área com este nome"),
    "condo_space_hourly_chk": (422, "invalid_hours", "Áreas por horário exigem abertura, fechamento e duração do bloco"),
    "condo_space_max_per_unit_chk": (422, "invalid_limit", "O limite por unidade deve ficar entre 1 e 10"),
    "maintenance_type_name_uk": (409, "duplicate_name", "Já existe um tipo com este nome"),
    "maintenance_location_name_uk": (409, "duplicate_name", "Já existe um local com este nome"),
    "service_provider_document_uk": (409, "duplicate_document", "Já existe um prestador com este CNPJ/CPF"),
    "service_provider_external_chk": (422, "invalid_provider", "Função e turno valem apenas para funcionários"),
    "service_provider_employee_chk": (422, "invalid_provider", "Documento e contrato valem apenas para prestadores externos"),
    "service_provider_contract_chk": (422, "invalid_provider", "Validade de contrato exige contrato mensal ou semestral/anual"),
    "preventive_recurring_chk": (422, "invalid_rule", "Regra recorrente exige frequência e primeira data"),
    "preventive_event_chk": (422, "invalid_rule", "Regra por evento exige evento e prazo de execução"),
    "preventive_active_provider_chk": (422, "provider_required", "Regra ativa exige um responsável"),
    "incident_approved_chk": (422, "approval_incomplete", "Aprovar exige prioridade e responsável"),
    "incident_rejected_chk": (422, "rejection_incomplete", "Recusar exige motivo e justificativa"),
    "incident_already_scheduled_chk": (422, "related_incident_required", "Informe a manutenção já agendada"),
    "incident_finished_chk": (422, "invalid_finish", "A conclusão não pode ser anterior ao início"),
    "incident_schedule_chk": (422, "invalid_schedule", "O fim da visita deve ser depois do início"),
    "incident_rating_chk": (422, "invalid_rating", "A avaliação vai de 1 a 5 e só vale para manutenção concluída"),
    "incident_preventive_reservation_uk": (409, "already_generated", "Esta reserva já gerou a manutenção"),
}

SQLSTATE_DEFAULTS: dict[str, tuple[int, str]] = {
    "23505": (409, "conflict"),             # unique_violation
    "23P01": (409, "conflict"),             # exclusion_violation
    "23503": (422, "invalid_reference"),    # foreign_key_violation
    "23502": (422, "missing_field"),        # not_null_violation
    "23514": (422, "rule_violation"),       # check_violation (inclusive as dos triggers)
    "22P02": (422, "invalid_value"),        # invalid_text_representation
}


def translate_db_error(exc: DBAPIError) -> AppError | None:
    orig = exc.orig
    sqlstate = getattr(orig, "sqlstate", None)
    diag = getattr(orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None)
    if constraint in CONSTRAINTS:
        return AppError(*CONSTRAINTS[constraint])
    if sqlstate in SQLSTATE_DEFAULTS:
        status, code = SQLSTATE_DEFAULTS[sqlstate]
        message = getattr(diag, "message_primary", None) or "Operação recusada pelo banco"
        return AppError(status, code, message)
    return None


def _body(err: AppError) -> dict:
    return {"error": {"code": err.code, "message": err.message}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=_body(exc))

    @app.exception_handler(DBAPIError)
    def handle_db_error(_: Request, exc: DBAPIError) -> JSONResponse:
        err = translate_db_error(exc)
        if err is None:
            raise exc
        return JSONResponse(status_code=err.status, content=_body(err))
