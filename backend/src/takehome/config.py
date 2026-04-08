from __future__ import annotations

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://orbital:orbital@db:5432/orbital_takehome"
    database_url_psycopg: str = "postgresql://orbital:orbital@db:5432/orbital_takehome"
    database_url_sync: str = "postgresql+psycopg://orbital:orbital@db:5432/orbital_takehome"

    openai_api_key: str = ""
    tavily_api_key: str = ""

    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/1"

    embedding_model: str = "text-embedding-3-small"
    llm_model: str = "gpt-4o"

    chunk_size: int = 2000
    chunk_overlap: int = 500
    summarization_token_threshold: int = 4000
    
    ragas_evaluation_enabled: bool = True

    upload_dir: str = "uploads"
    max_upload_size: int = 25 * 1024 * 1024  # 25 MB

    model_config = {"env_file": ".env"}


settings = Settings()

if settings.openai_api_key:
    os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)
    
if settings.tavily_api_key:
    os.environ.setdefault("TAVILY_API_KEY", settings.tavily_api_key)
