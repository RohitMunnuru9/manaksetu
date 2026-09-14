from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_jwt_login_and_protected_workspace() -> None:
    settings = get_settings()
    with TestClient(app) as client:
        assert client.get("/api/v1/standards").status_code == 401

        login = client.post("/api/v1/auth/login", json={
            "email": settings.demo_user_email,
            "password": settings.demo_user_password,
        })
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        profile = client.get("/api/v1/auth/me", headers=headers)
        assert profile.status_code == 200
        assert profile.json()["role"] == "procurement_officer"
        assert client.get("/api/v1/standards", headers=headers).status_code == 200

        oauth_login = client.post("/api/v1/auth/token", data={
            "username": settings.demo_user_email,
            "password": settings.demo_user_password,
        })
        assert oauth_login.status_code == 200
