import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import repository
from app.main import app

SOURCE_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    templates_dir = tmp_path / "templates"
    shutil.copytree(SOURCE_TEMPLATES_DIR, templates_dir)
    monkeypatch.setattr(repository, "TEMPLATES_DIR", templates_dir)
    return TestClient(app)


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_and_static_files(client):
    index = client.get("/")
    assert index.status_code == 200
    assert "DevResume Studio" in index.text

    css = client.get("/static/css/app.css")
    assert css.status_code == 200
    assert css.headers["content-type"].startswith("text/css")

    js = client.get("/static/js/app.js")
    assert js.status_code == 200
    assert "javascript" in js.headers["content-type"]


def test_list_templates_is_sorted_and_minimal(client):
    response = client.get("/api/templates")
    assert response.status_code == 200
    templates = response.json()

    assert [item["slug"] for item in templates] == [
        "fullstack",
        "backend",
        "frontend",
        "ai_data",
        "fresher",
    ]
    assert all("profile" not in item for item in templates)


def test_get_template_returns_full_document(client):
    response = client.get("/api/templates/fullstack")
    assert response.status_code == 200
    data = response.json()

    assert data["slug"] == "fullstack"
    assert data["profile"]["fullName"]
    assert {section["id"] for section in data["sections"]} >= {
        "summary",
        "skills",
        "experience",
        "projects",
        "education",
    }
    assert data["skills"]
    assert data["styling"]["density"] in {"compact", "normal", "relaxed"}


def test_unknown_template_returns_404(client):
    response = client.get("/api/templates/does_not_exist")
    assert response.status_code == 404


def test_every_template_file_is_valid(client):
    for item in client.get("/api/templates").json():
        response = client.get(f"/api/templates/{item['slug']}")
        assert response.status_code == 200, item["slug"]
        assert response.json()["slug"] == item["slug"]


def test_create_template_persists_empty_payload(client, tmp_path):
    payload = {
        "name": "JD Mới",
        "description": "",
        "profile": {},
        "sections": [],
        "skills": [],
        "experiences": [],
        "projects": [],
        "styling": {},
    }
    response = client.post("/api/templates", json=payload)
    assert response.status_code == 201
    created = response.json()

    assert created["slug"] == "jd_moi"
    assert created["name"] == "JD Mới"
    assert created["order"] == 6

    saved = repository.TEMPLATES_DIR / "jd_moi.json"
    assert saved.is_file()
    raw = json.loads(saved.read_text(encoding="utf-8"))
    assert raw["slug"] == "jd_moi"
    assert raw["profile"] == {}
    assert raw["skills"] == []

    slugs = [item["slug"] for item in client.get("/api/templates").json()]
    assert slugs[-1] == "jd_moi"


def test_create_template_generates_unique_slug(client):
    first = client.post(
        "/api/templates",
        json={"name": "Preset Test", "profile": {}, "sections": [], "skills": [], "experiences": [], "projects": [], "styling": {}},
    )
    second = client.post(
        "/api/templates",
        json={"name": "Preset Test", "profile": {}, "sections": [], "skills": [], "experiences": [], "projects": [], "styling": {}},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["slug"] == "preset_test"
    assert second.json()["slug"] == "preset_test_2"
    assert (repository.TEMPLATES_DIR / "preset_test_2.json").is_file()


def test_update_template_persists_changes(client):
    original = client.get("/api/templates/fullstack").json()
    payload = {
        "name": original["name"],
        "description": "Đã chỉnh sửa",
        "profile": {**original["profile"], "fullName": "NGƯỜI DÙNG MỚI"},
        "sections": original["sections"],
        "skills": original["skills"],
        "experiences": original["experiences"],
        "projects": original["projects"],
        "styling": original["styling"],
    }

    response = client.put("/api/templates/fullstack", json=payload)
    assert response.status_code == 200
    updated = response.json()
    assert updated["slug"] == "fullstack"
    assert updated["order"] == original["order"]
    assert updated["profile"]["fullName"] == "NGƯỜI DÙNG MỚI"
    assert updated["description"] == "Đã chỉnh sửa"

    saved = json.loads((repository.TEMPLATES_DIR / "fullstack.json").read_text(encoding="utf-8"))
    assert saved["profile"]["fullName"] == "NGƯỜI DÙNG MỚI"


def test_update_unknown_template_returns_404(client):
    response = client.put(
        "/api/templates/does_not_exist",
        json={"name": "X", "profile": {}, "sections": [], "skills": [], "experiences": [], "projects": [], "styling": {}},
    )
    assert response.status_code == 404

