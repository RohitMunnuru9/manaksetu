import logging
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Values that have appeared in committed example files and documentation. None
# of them is a secret, so none may ever be used to sign a token outside local
# development -- a token signed with a published string is forgeable by anyone.
PUBLISHED_PLACEHOLDER_SECRETS = {
    "replace-with-a-long-random-secret",
    "development-only-change-me",
    "change-this-password",
    "changeme",
    "secret",
}

MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    app_name: str = "ManakSetu AI API"
    environment: str = "development"
    database_url: str = "sqlite:///./manaksetu.db"
    # No default. Development generates an ephemeral secret at startup; any
    # other environment must supply a real one or the application refuses to run.
    jwt_secret: str | None = None
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    upload_dir: Path = Path("./data/uploads")
    max_upload_mb: int = 20
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    demo_user_email: str = "officer@manaksetu.gov.in"
    demo_user_password: str = "ManakSetu@2026"
    # Demonstration accounts are seeded only when this is true. It defaults to
    # true so a local checkout works immediately, and must be turned off for any
    # shared deployment.
    seed_demo_users: bool = True

    # Local language model, used only to phrase retrieval evidence for a reader.
    # Enabling it cannot change which standards are recommended. When Ollama is
    # absent the connection fails immediately and the analysis completes without
    # prose, so leaving this on is safe on a machine that has no model.
    enable_llm_explanations: bool = True
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    # Generous enough to absorb a cold model load (a 7B model takes roughly
    # forty seconds to page in), short enough that a genuinely stalled model
    # cannot hold an analysis open indefinitely.
    ollama_timeout_seconds: float = 120.0
    # How long Ollama keeps the weights resident after a request.
    ollama_keep_alive: str = "30m"
    # Load the model in the background at startup so the first officer request
    # does not pay the cold-start cost.
    ollama_warm_on_startup: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_development(self) -> bool:
        return self.environment.strip().lower() in {"development", "dev", "local", "test"}

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _resolve_jwt_secret(self) -> "Settings":
        supplied = (self.jwt_secret or "").strip()
        unusable = (
            not supplied
            or supplied.lower() in PUBLISHED_PLACEHOLDER_SECRETS
            or len(supplied) < MIN_SECRET_LENGTH
        )
        if not unusable:
            return self

        if not self.is_development:
            raise RuntimeError(
                "JWT_SECRET is missing, too short, or set to a published placeholder. "
                f"Set JWT_SECRET to a random string of at least {MIN_SECRET_LENGTH} characters "
                "before running outside development."
            )

        # Development: mint a throwaway secret rather than fall back to a known
        # string. Sessions do not survive a restart, which is the correct
        # trade-off for a local machine and leaves no secret in the repository.
        object.__setattr__(self, "jwt_secret", secrets.token_urlsafe(48))
        logger.warning(
            "No usable JWT_SECRET supplied; generated an ephemeral development secret. "
            "Existing sessions are invalidated on every restart."
        )
        return self

    @property
    def signing_key(self) -> str:
        assert self.jwt_secret  # guaranteed by the validator above
        return self.jwt_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
