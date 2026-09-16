"""Tests for secret handling and role-based access control."""

import pytest
from fastapi.testclient import TestClient

from app.config import PUBLISHED_PLACEHOLDER_SECRETS, Settings
from app.main import app
from app.config import get_settings
from app.security import Permission, permissions_for


# --- Signing secret ------------------------------------------------------

def test_published_placeholder_is_refused_outside_development() -> None:
    """A secret that appears in a committed file can be used to forge tokens."""
    for placeholder in PUBLISHED_PLACEHOLDER_SECRETS:
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            Settings(environment="production", jwt_secret=placeholder)


def test_missing_or_short_secret_is_refused_outside_development() -> None:
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        Settings(environment="production", jwt_secret=None)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        Settings(environment="production", jwt_secret="too-short")


def test_production_accepts_a_real_secret() -> None:
    settings = Settings(environment="production", jwt_secret="x" * 40)
    assert settings.signing_key == "x" * 40


def test_development_generates_an_ephemeral_secret_rather_than_a_known_one() -> None:
    first = Settings(environment="development", jwt_secret=None)
    second = Settings(environment="development", jwt_secret=None)
    assert first.signing_key and len(first.signing_key) >= 32
    assert first.signing_key != second.signing_key, "development secret must not be a fixed string"
    assert first.signing_key.lower() not in PUBLISHED_PLACEHOLDER_SECRETS


# --- Role permissions ----------------------------------------------------

def test_unknown_role_has_no_permissions() -> None:
    """An unrecognised or revoked role must fail closed, not open."""
    assert permissions_for("not_a_real_role") == frozenset()
    assert permissions_for("") == frozenset()


def test_supplier_cannot_review_export_or_read_audit() -> None:
    supplier = permissions_for("supplier")
    assert Permission.TENDER_READ in supplier
    for denied in (Permission.REVIEW_SUBMIT, Permission.REPORT_EXPORT, Permission.AUDIT_READ, Permission.TENDER_CREATE):
        assert denied not in supplier


def test_only_expert_and_admin_may_verify_standards() -> None:
    assert Permission.STANDARD_VERIFY in permissions_for("standards_expert")
    assert Permission.STANDARD_VERIFY in permissions_for("system_admin")
    assert Permission.STANDARD_VERIFY not in permissions_for("procurement_officer")
    assert Permission.STANDARD_VERIFY not in permissions_for("department_admin")


# --- Enforcement at the API ----------------------------------------------

def _token(client: TestClient, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_restricted_role_is_refused_by_the_api_not_merely_by_the_interface() -> None:
    settings = get_settings()
    with TestClient(app) as client:
        supplier = {"Authorization": f"Bearer {_token(client, 'supplier@example.in', settings.demo_user_password)}"}
        officer = {"Authorization": f"Bearer {_token(client, settings.demo_user_email, settings.demo_user_password)}"}

        # Permitted for the supplier: reading the catalogue.
        assert client.get("/api/v1/standards", headers=supplier).status_code == 200

        # Refused for the supplier, allowed for the officer.
        assert client.get("/api/v1/audit", headers=supplier).status_code == 403
        assert client.get("/api/v1/audit", headers=officer).status_code == 200

        created = client.post(
            "/api/v1/tenders/analyse",
            json={"title": "Supplier attempt", "description": "Purchase industrial safety helmet units for workers.", "language": "en"},
            headers=supplier,
        )
        assert created.status_code == 403


def test_profile_reports_the_permissions_the_api_enforces() -> None:
    settings = get_settings()
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {_token(client, 'supplier@example.in', settings.demo_user_password)}"}
        profile = client.get("/api/v1/auth/me", headers=headers).json()
        assert profile["role"] == "supplier"
        assert profile["permissions"] == sorted(permissions_for("supplier"))
