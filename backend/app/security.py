from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from .config import get_settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def create_access_token(subject: str) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": subject, "exp": expires}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
