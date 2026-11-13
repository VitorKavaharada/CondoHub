from datetime import date, datetime, timedelta

from tests.conftest import ALINE, ROBERTO, as_user, error_code, url


def _by_name(client, path, name, **params):
    return next(item for item in client.get(url(path), params=params).json() if item["name"] == name)


def _open_incident(client, title="Vazamento no teto da garagem", location="Garagem G2", type_="Hidráulica"):
    unit = next(u for u in client.get(url("/units")).json() if u["label"] == "Apto 302 · Bloco B")
    response = client.post(
        url("/incidents"),
        json={
            "title": title,
            "description": "Goteira perto da vaga 214",
            "location_id": _by_name(client, "/maintenance-locations", location)["id"],
            "maintenance_type_id": _by_name(client, "/maintenance-types", type_)["id"],
            "unit_id": unit["id"],
            "photo_urls": ["/files/foto1.jpg"],
        },
        headers=as_user(ALINE),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_incident_lifecycle(client):
    incident = _open_incident(client)
    assert incident["status"] == "submitted"
    assert incident["code"].startswith("MNT-")
    assert len(incident["attachments"]) == 1
    iid = incident["id"]
    sindico = as_user(ROBERTO)

    ramos = _by_name(client, "/service-providers", "Hidráulica Ramos")
    eletro = _by_name(client, "/service-providers", "Eletro Silva")
    approve = {"priority": "high", "assigned_provider_id": ramos["id"]}

    direct = client.post(url(f"/incidents/{iid}/approve"), json=approve, headers=sindico)
    assert direct.status_code == 409 and error_code(direct) == "invalid_transition"

    assert client.post(url(f"/incidents/{iid}/review"), headers=sindico).json()["status"] == "under_review"

    wrong = client.post(url(f"/incidents/{iid}/approve"), json={**approve, "assigned_provider_id": eletro["id"]}, headers=sindico)
    assert wrong.status_code == 422 and error_code(wrong) == "rule_violation"

    approved = client.post(url(f"/incidents/{iid}/approve"), json=approve, headers=sindico).json()
    assert approved["status"] == "approved"
    due = datetime.fromisoformat(approved["due_at"])
    assert timedelta(hours=47) < due - datetime.now(due.tzinfo) <= timedelta(hours=48)

    client.post(url(f"/incidents/{iid}/start"), headers=sindico)
    done = client.post(url(f"/incidents/{iid}/finish"), json={"cost": "350.00"}, headers=sindico).json()
    assert done["status"] == "done"

    rated = client.post(url(f"/incidents/{iid}/rating"), json={"rating": 5, "feedback": "Rápido"}, headers=as_user(ALINE)).json()
    assert rated["resident_rating"] == 5

    history = done["history"]
    assert [h["status"] for h in history] == ["submitted", "under_review", "approved", "in_progress", "done"]
    approved_step = history[2]
    assert approved_step["note"] == "Prioridade alta. Responsável: Hidráulica Ramos."
    assert approved_step["changed_by"]["name"] == "Roberto Mendes"

    kinds = {n["kind"] for n in client.get(url("/notifications"), headers=as_user(ALINE)).json()}
    assert {"incident_approved", "incident_done"} <= kinds

    mine = client.get(url("/incidents"), params={"mine": True}, headers=as_user(ALINE)).json()
    assert [i["id"] for i in mine] == [iid]

    groups = client.get(url("/maintenance-history/groups"), params={"by": "location"}).json()
    assert (groups[0]["name"], groups[0]["count"]) == ("Garagem G2", 1)


def test_reject_already_scheduled(client):
    sindico = as_user(ROBERTO)
    carlos = _by_name(client, "/service-providers", "Carlos Souza")
    piscina = _by_name(client, "/maintenance-locations", "Piscina")
    portoes = _by_name(client, "/maintenance-types", "Portões e acesso")
    scheduled = client.post(
        url("/incidents/scheduled"),
        json={
            "title": "Troca de dobradiças do portão",
            "location_id": piscina["id"],
            "maintenance_type_id": portoes["id"],
            "priority": "medium",
            "assigned_provider_id": carlos["id"],
            "scheduled_start_at": (datetime.now() + timedelta(days=6)).astimezone().isoformat(),
        },
        headers=sindico,
    ).json()
    assert scheduled["status"] == "approved" and scheduled["origin"] == "manual"

    incident = _open_incident(client, "Portão da piscina rangendo", "Piscina", "Portões e acesso")
    iid = incident["id"]
    assert [i["code"] for i in incident["location_context"]["upcoming"]] == [scheduled["code"]]

    missing = client.post(
        url(f"/incidents/{iid}/reject"), json={"reason": "already_scheduled", "note": "Já agendada"}, headers=sindico
    )
    assert missing.status_code == 422 and error_code(missing) == "related_incident_required"

    rejected = client.post(
        url(f"/incidents/{iid}/reject"),
        json={"reason": "already_scheduled", "note": "Já agendada", "related_incident_id": scheduled["id"]},
        headers=sindico,
    ).json()
    assert rejected["status"] == "rejected"
    assert rejected["related_incident"]["code"] == scheduled["code"]
    assert [h["status"] for h in rejected["history"]] == ["submitted", "rejected"]

    summary = client.get(url("/incidents/summary")).json()
    assert summary["by_status"]["rejected"] == 1 and summary["by_status"]["approved"] == 1


def test_providers(client):
    hidraulica = _by_name(client, "/maintenance-types", "Hidráulica")
    serving = [p["name"] for p in client.get(url("/service-providers"), params={"maintenance_type_id": hidraulica["id"]}).json()]
    assert sorted(serving) == ["Carlos Souza", "Hidráulica Ramos"]

    carlos = _by_name(client, "/service-providers", "Carlos Souza")
    detail = client.get(url(f"/service-providers/{carlos['id']}")).json()
    assert "Tratamento da piscina" in [r["name"] for r in detail["schedule"]["preventive_rules"]]

    created = client.post(
        url("/service-providers"),
        json={"kind": "external", "name": "Jardim Verde", "document": "67.890.123/0001-06", "contract_type": "monthly",
              "contract_valid_until": "2027-06-30", "specialty_ids": [_by_name(client, "/maintenance-types", "Jardinagem")["id"]]},
    )
    assert created.status_code == 201, created.text
    assert [s["name"] for s in created.json()["specialties"]] == ["Jardinagem"]

    invalid = client.post(url("/service-providers"), json={"kind": "employee", "name": "X", "contract_type": "monthly"})
    assert invalid.status_code == 422 and error_code(invalid) == "invalid_provider"

    paused = client.patch(url(f"/service-providers/{created.json()['id']}"), json={"is_active": False}).json()
    assert paused["is_active"] is False


def test_preventive_rules_calendar_and_job(client):
    sindico = as_user(ROBERTO)
    carlos = _by_name(client, "/service-providers", "Carlos Souza")
    first = date.today() + timedelta(days=2)
    rule = client.post(
        url("/preventive-maintenances"),
        json={
            "name": "Limpeza das calhas",
            "maintenance_type_id": _by_name(client, "/maintenance-types", "Hidráulica")["id"],
            "location_id": _by_name(client, "/maintenance-locations", "Garagem G1")["id"],
            "trigger_type": "recurring",
            "frequency": "weekly",
            "first_run_date": first.isoformat(),
            "run_time": "07:30",
            "default_provider_id": carlos["id"],
        },
        headers=sindico,
    )
    assert rule.status_code == 201, rule.text
    rule = rule.json()
    next_run = datetime.fromisoformat(rule["next_run_at"])
    assert next_run.date() == first and next_run.hour == 7 and next_run.minute == 30

    calendar = client.get(url("/maintenance-calendar"), params={"month": first.strftime("%Y-%m")}).json()
    assert any(e["projected"] and e["preventive_maintenance_id"] == rule["id"] for e in calendar["events"])

    event_rule = client.post(
        url("/preventive-maintenances"),
        json={"name": "Limpeza", "maintenance_type_id": _by_name(client, "/maintenance-types", "Limpeza")["id"],
              "location_id": _by_name(client, "/maintenance-locations", "Garagem G1")["id"], "trigger_type": "event",
              "trigger_event": "reservation_ended", "execution_window": "within_4h", "default_provider_id": carlos["id"]},
        headers=sindico,
    )
    assert event_rule.status_code == 422  # local não é área reservável

    job = client.post(url("/jobs/preventive-maintenance/run"), params={"now": (next_run + timedelta(minutes=1)).isoformat()})
    assert job.status_code == 200, job.text
    assert len(job.json()["created"]) >= 1, job.json()
    after = client.get(url(f"/preventive-maintenances/{rule['id']}")).json()
    assert datetime.fromisoformat(after["next_run_at"]) == next_run + timedelta(weeks=1)

    paused = client.patch(url(f"/preventive-maintenances/{rule['id']}"), json={"is_active": False}).json()
    assert paused["next_run_at"] is None


def test_event_rule_generates_after_reservation(client):
    salao = next(s for s in client.get(url("/spaces")).json() if s["name"] == "Salão de festas")
    unit = next(u for u in client.get(url("/units")).json() if u["label"] == "Apto 302 · Bloco B")
    day = date.today() + timedelta(days=9)
    reservation = client.post(
        url("/reservations"),
        json={"space_id": salao["id"], "unit_id": unit["id"], "date": day.isoformat(), "accept_terms": True},
        headers=as_user(ALINE),
    ).json()
    client.post(url(f"/reservations/{reservation['id']}/approve"), headers=as_user(ROBERTO))

    after_end = datetime.fromisoformat(reservation["end_datetime"]) + timedelta(hours=1)
    first = client.post(url("/jobs/preventive-maintenance/run"), params={"now": after_end.isoformat()}).json()
    assert first["created"], first

    client.post(url("/jobs/preventive-maintenance/run"), params={"now": after_end.isoformat()}).json()
    cleaning = [
        i for i in client.get(url("/incidents"), params={"origin": "preventive"}).json()
        if i["title"] == "Limpeza pós-reserva · Salão"
    ]
    assert len(cleaning) == 1  # não gera duas vezes para a mesma reserva
    assert cleaning[0]["preventive_trigger"] == "event"
    due = datetime.fromisoformat(cleaning[0]["due_at"])
    assert due == datetime.fromisoformat(reservation["end_datetime"]) + timedelta(hours=4)
