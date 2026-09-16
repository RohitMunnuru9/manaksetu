from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import User

password_hash = PasswordHash.recommended()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class Permission:
    """Capabilities an endpoint can require. Named for the action, not the role."""

    TENDER_READ = "tender:read"
    TENDER_CREATE = "tender:create"
    REVIEW_SUBMIT = "review:submit"
    REPORT_EXPORT = "report:export"
    AUDIT_READ = "audit:read"
    STANDARD_VERIFY = "standard:verify"


# Role to capability map. A role that is absent from this table has no
# capabilities at all, so an unrecognised or revoked role fails closed.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "procurement_officer": frozenset({
        Permission.TENDER_READ,
        Permission.TENDER_CREATE,
        Permission.REVIEW_SUBMIT,
        Permission.REPORT_EXPORT,
        Permission.AUDIT_READ,
    }),
    "technical_evaluator": frozenset({
        Permission.TENDER_READ,
        Permission.REVIEW_SUBMIT,
        Permission.REPORT_EXPORT,
        Permission.AUDIT_READ,
    }),
    "standards_expert": frozenset({
        Permission.TENDER_READ,
        Permission.REVIEW_SUBMIT,
        Permission.REPORT_EXPORT,
        Permission.AUDIT_READ,
        Permission.STANDARD_VERIFY,
    }),
    "department_admin": frozenset({
        Permission.TENDER_READ,
        Permission.REPORT_EXPORT,
        Permission.AUDIT_READ,
    }),
    "system_admin": frozenset({
        Permission.TENDER_READ,
        Permission.TENDER_CREATE,
        Permission.REVIEW_SUBMIT,
        Permission.REPORT_EXPORT,
        Permission.AUDIT_READ,
        Permission.STANDARD_VERIFY,
    }),
    # Suppliers and MSMEs may look up standards but take no part in review.
    "supplier": frozenset({Permission.TENDER_READ}),
}


def permissions_for(role: str) -> frozenset[str]:
    return ROLE_PERMISSIONS.get(role, frozenset())


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def create_access_token(subject: str) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": subject, "exp": expires}, settings.signing_key, algorithm=settings.jwt_algorithm)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session",
        headers={"WWW-Authenticate": "Bearer"},
    )
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.signing_key, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub", ""))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise credentials_error
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_permission(permission: str):
    """Dependency factory gating an endpoint on a single capability."""

    def dependency(user: User = Depends(get_current_user)) -> User:
        if permission not in permissions_for(user.role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role ({user.role.replace('_', ' ')}) is not permitted to {permission.replace(':', ' ')}.",
            )
        return user

    return dependency
