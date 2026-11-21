from functools import lru_cache
from supabase import create_client, Client
from backend.config import Config

@lru_cache(maxsize=1)
def get_supabase() -> Client:
    if not Config.SUPABASE_URL or not Config.SUPABASE_SECRET_KEY:
        raise RuntimeError("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env.")
    return create_client(Config.SUPABASE_URL, Config.SUPABASE_SECRET_KEY)
