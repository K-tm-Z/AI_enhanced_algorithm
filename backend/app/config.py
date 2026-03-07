from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",   # ✅ ignore unknown env vars
    )

    PORT: int = 4000
    MONGO_URI: str = ""
    JWT_SECRET: str = ""

    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 1 Hour default expiry for access tokens
    BCRYPT_ROUNDS: int = 12  # bcrypt rounds for password hashing

    # --- OpenRouter STT ---
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1/chat/completions"
    OPENROUTER_HTTP_REFERER: str = ""      # optional attribution header :contentReference[oaicite:5]{index=5}
    OPENROUTER_APP_TITLE: str = ""         # optional attribution header :contentReference[oaicite:6]{index=6}

    OPENROUTER_MM_MODEL: str = "openai/gpt-4o"  # pick any OpenRouter multimodal model
    STT_MODEL: str = "openai/gpt-audio-mini"    # pick any OpenRouter audio-capable model
    STT_TARGET_FORMAT: str = "wav"         # "wav" or "mp3" (current model supports only these 2)

    # --- Email (SMTP) ---
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = ""

    # --- Forms ---
    # Global recipient for all form submissions
    FORMS_RECIPIENT_EMAIL: str = ""

    # --- Storage ---
    STORAGE_DIR: str = "storage"

settings = Settings()