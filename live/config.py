import os
from pathlib import Path
from dotenv import load_dotenv

# Carrega o .env localizado na raiz do projeto, independentemente da pasta
# de onde o comando `python app.py` foi executado.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

class Config:
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-only-change-me")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
    LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
    LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
    LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
    ADMIN_MASTER_PASSWORD = os.getenv("ADMIN_MASTER_PASSWORD", "")
