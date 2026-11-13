from datetime import date, timedelta

from sqlalchemy import text

from tests.conftest import ALINE, MARCOS, PAULA, ROBERTO, as_user, error_code, url


def _space(client, name):
    return next(s for s in client.get(url("/spaces")).json() if s["name"] == name)


def _unit(client, label):
    return next(u for u in client.get(url("/units")).json() if u["label"] == label)


def _day(offset):
    return (date.today() + timedelta(days=offset)).isoformat()


def _reserve(client, user, space, unit, day, start_time=None, accept=True):
    body = {"space_id": space["id"], "unit_id": unit["id"], "date": day, "accept_terms": accept}
    if start_time:
        body["start_time"] = start_time
    return client.post(url("/reservations"), json=body, headers=as_user(user))


def test_spaces_and_grid(client):
    salao = _space(client, "Salão de festas")
    assert salao["booking_mode"] == "full_day"
    assert salao["rules_document"]["version"] == 1

    quadra = _space(client, "Quadra poliesportiva")
    slots = client.get(url(f"/spaces/{quadra['id']}/slots"), params={"date": _day(5)}).json()["slots"]
    assert [s["start_time"] for s in slots] == ["07:00:00", "09:00:00", "11:00:00", "13:00:00", "15:00:00", "17:00:00", "19:00:00"]
    assert {s["status"] for s in slots} == {"available"}

    month = date.today().strftime("%Y-%m")
    days = client.get(url(f"/spaces/{quadra['id']}/availability"), params={"month": month}).json()["days"]
    assert days[date.today().day - 1]["status"] in {"available", "partial", "past"}


def test_full_day_reservation_flow(client):
    salao = _space(client, "Salão de festas")
    apto302 = _unit(client, "Apto 302 · Bloco B")
    apto104 = _unit(client, "Apto 104 · Bloco A")
    day = _day(10)

    assert error_code(_reserve(client, ALINE, salao, apto302, day, accept=False)) == "terms_required"

    created = _reserve(client, ALINE, salao, apto302, day)
    assert created.status_code == 201, created.text
    reservation = created.json()
    assert reservation["status"] == "pending"
    assert reservation["terms_accepted_at"] is not None

    taken = _reserve(client, MARCOS, salao, apto104, day)
    assert taken.status_code == 409 and error_code(taken) == "slot_taken"

    # Mesma unidade em outra área no mesmo dia: conflito da unidade (EXCLUDE no banco)
    quadra = _space(client, "Quadra poliesportiva")
    conflict = _reserve(client, ALINE, quadra, apto302, day, "09:00")
    assert conflict.status_code == 409 and error_code(conflict) == "unit_conflict"

    approved = client.post(url(f"/reservations/{reservation['id']}/approve"), headers=as_user(ROBERTO))
    assert approved.json()["status"] == "confirmed"
    notifications = client.get(url("/notifications"), headers=as_user(ALINE)).json()
    assert any(n["kind"] == "reservation_confirmed" for n in notifications)

    mine = client.get(url("/reservations"), params={"mine": True}, headers=as_user(ALINE)).json()
    assert [r["id"] for r in mine] == [reservation["id"]]

    canceled = client.post(url(f"/reservations/{reservation['id']}/cancel"), json={"reason": "Mudança de planos"}, headers=as_user(ALINE))
    assert canceled.json()["status"] == "canceled"
    assert _reserve(client, MARCOS, salao, apto104, day).status_code == 201


def test_hourly_rules(client):
    quadra = _space(client, "Quadra poliesportiva")
    apto302 = _unit(client, "Apto 302 · Bloco B")

    assert error_code(_reserve(client, ALINE, quadra, apto302, _day(3), "08:00")) == "invalid_slot"
    assert error_code(_reserve(client, ALINE, quadra, apto302, _day(400), "09:00")) == "beyond_horizon"
    assert error_code(_reserve(client, ALINE, quadra, apto302, _day(-1), "09:00")) == "date_in_past"

    for offset in (3, 4, 5):
        assert _reserve(client, ALINE, quadra, apto302, _day(offset), "09:00").status_code == 201
    limit = _reserve(client, ALINE, quadra, apto302, _day(6), "09:00")
    assert limit.status_code == 422 and error_code(limit) == "limit_reached"

    slots = client.get(url(f"/spaces/{quadra['id']}/slots"), params={"date": _day(3)}).json()["slots"]
    assert next(s for s in slots if s["start_time"] == "09:00:00")["status"] == "occupied"


def test_authorization_rules(client):
    quadra = _space(client, "Quadra poliesportiva")
    apto302 = _unit(client, "Apto 302 · Bloco B")

    assert error_code(_reserve(client, MARCOS, quadra, apto302, _day(3), "09:00")) == "unit_not_linked"

    no_user = client.post(url("/reservations"), json={"space_id": quadra["id"], "unit_id": apto302["id"], "date": _day(3)})
    assert no_user.status_code == 400 and error_code(no_user) == "user_required"

    stranger = client.get(url("/me"), headers=as_user("00000000-0000-0000-0000-000000000000"))
    assert stranger.status_code == 422 and error_code(stranger) == "unknown_user"


def test_block_makes_space_unavailable(client):
    quadra = _space(client, "Quadra poliesportiva")
    apto302 = _unit(client, "Apto 302 · Bloco B")
    day = _day(7)
    block = client.post(
        url(f"/spaces/{quadra['id']}/blocks"),
        json={"starts_at": f"{day}T00:00:00-03:00", "ends_at": f"{day}T23:59:00-03:00", "reason": "Manutenção"},
        headers=as_user(ROBERTO),
    )
    assert block.status_code == 201, block.text
    assert error_code(_reserve(client, ALINE, quadra, apto302, day, "09:00")) == "space_unavailable"


def test_admin_edits_space(client):
    quadra = _space(client, "Quadra poliesportiva")
    updated = client.patch(url(f"/spaces/{quadra['id']}"), json={"slot_minutes": 60, "max_per_unit": 5})
    assert updated.json()["slot_minutes"] == 60
    invalid = client.patch(url(f"/spaces/{quadra['id']}"), json={"max_per_unit": 20})
    assert invalid.status_code == 422

    created = client.post(
        url("/spaces"),
        json={"name": "Brinquedoteca", "booking_mode": "hourly", "opens_at": "09:00", "closes_at": "18:00", "slot_minutes": 60},
    )
    assert created.status_code == 201, created.text
    locations = [loc["name"] for loc in client.get(url("/maintenance-locations")).json()]
    assert "Brinquedoteca" in locations
    duplicate = client.post(url("/spaces"), json={"name": "Brinquedoteca", "booking_mode": "full_day"})
    assert duplicate.status_code == 409 and error_code(duplicate) == "duplicate_name"


# ---------------------------------------------------------------- inadimplência


def _set_delinquent(session, unit, value=True):
    session.execute(text("UPDATE unit SET inadimplente = :v WHERE id = :id"), {"v": value, "id": unit["id"]})
    session.commit()  # fecha o savepoint: um erro da API depois não desfaz o ajuste


def test_inadimplente_persisted_on_unit(client):
    apto210 = _unit(client, "Apto 210 · Bloco A")
    apto302 = _unit(client, "Apto 302 · Bloco B")
    assert apto210["inadimplente"] is True
    assert apto302["inadimplente"] is False

    paula = client.get(url("/me"), headers=as_user(PAULA)).json()
    assert paula["has_pending_dues"] is True
    assert paula["units"][0]["inadimplente"] is True
    assert client.get(url("/me"), headers=as_user(ALINE)).json()["has_pending_dues"] is False


def test_inadimplente_blocks_every_space(client):
    apto210 = _unit(client, "Apto 210 · Bloco A")
    for name, start in (("Quadra poliesportiva", "09:00"), ("Salão de festas", None)):
        blocked = _reserve(client, PAULA, _space(client, name), apto210, _day(3), start)
        assert blocked.status_code == 403 and error_code(blocked) == "pending_dues", blocked.text
    # Nada foi gravado
    assert client.get(url("/reservations"), params={"mine": True}, headers=as_user(PAULA)).json() == []


def test_inadimplencia_checked_before_other_rules(client):
    quadra = _space(client, "Quadra poliesportiva")
    apto210 = _unit(client, "Apto 210 · Bloco A")
    # Horário inválido e data passada: a inadimplência responde primeiro
    assert error_code(_reserve(client, PAULA, quadra, apto210, _day(3), "08:00")) == "pending_dues"
    assert error_code(_reserve(client, PAULA, quadra, apto210, _day(-1), "09:00")) == "pending_dues"


def test_inadimplencia_blocks_all_residents_of_unit(client, session):
    quadra = _space(client, "Quadra poliesportiva")
    apto302 = _unit(client, "Apto 302 · Bloco B")
    # Marcos passa a morar também no 302 (junto com a Aline)
    session.execute(
        text(
            "INSERT INTO unit_resident (condominium_id, unit_id, user_id, relation) "
            "VALUES (:c, :u, :m, 'resident')"
        ),
        {"c": "11111111-1111-1111-1111-111111111111", "u": apto302["id"], "m": MARCOS},
    )
    session.commit()
    _set_delinquent(session, apto302)

    for user in (ALINE, MARCOS):
        blocked = _reserve(client, user, quadra, apto302, _day(3), "09:00")
        assert blocked.status_code == 403 and error_code(blocked) == "pending_dues", (user, blocked.text)

    # Regularizou: volta a reservar
    _set_delinquent(session, apto302, False)
    assert _reserve(client, ALINE, quadra, apto302, _day(3), "09:00").status_code == 201


def test_inadimplencia_blocks_editing_reservation(client, session):
    quadra = _space(client, "Quadra poliesportiva")
    apto302 = _unit(client, "Apto 302 · Bloco B")
    reservation = _reserve(client, ALINE, quadra, apto302, _day(3), "09:00").json()

    _set_delinquent(session, apto302)
    edited = client.patch(
        url(f"/reservations/{reservation['id']}"), json={"date": _day(4), "start_time": "11:00"}, headers=as_user(ALINE)
    )
    assert edited.status_code == 403 and error_code(edited) == "pending_dues"
    # Cancelar continua permitido
    canceled = client.post(url(f"/reservations/{reservation['id']}/cancel"), json={}, headers=as_user(ALINE))
    assert canceled.json()["status"] == "canceled"
