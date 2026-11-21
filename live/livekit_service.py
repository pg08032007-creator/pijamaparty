from livekit import api
from backend.config import Config

def create_access_token(room_name: str, identity: str, can_publish: bool = False) -> str:
    """Gera token LiveKit. Chamar somente após validar a autorização no backend."""
    if not all([Config.LIVEKIT_API_KEY, Config.LIVEKIT_API_SECRET]):
        raise RuntimeError("Configure LIVEKIT_API_KEY e LIVEKIT_API_SECRET no arquivo .env.")

    token = api.AccessToken(Config.LIVEKIT_API_KEY, Config.LIVEKIT_API_SECRET)
    token.with_identity(identity)
    token.with_grants(api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=can_publish,
        can_subscribe=True,
        can_publish_data=True,
    ))
    return token.to_jwt()
