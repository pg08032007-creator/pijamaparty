from pathlib import Path
import hashlib
import secrets
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from backend.config import Config
from backend.services.supabase_service import get_supabase
from backend.services.livekit_service import create_access_token

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = Flask(__name__, static_folder=None)
app.config.from_object(Config)

def _json_error(message, status):
    return jsonify({"error": message}), status

def _room_code():
    return "partylive-main"

def _hash_secret(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _admin_serializer():
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="partylives-admin-v1")

@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.get("/<path:filename>")
def frontend_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "PartyLives backend"})

@app.post("/api/live/create")
def create_live():
    """Create/activate the single live room and return a one-time host credential."""
    data = request.get_json(silent=True) or {}
    password = str(data.get("password", "")).strip()
    identity = str(data.get("identity", "host")).strip()[:60]
    if len(password) < 1:
        return _json_error("Defina uma senha para a live.", 400)
    if not Config.LIVEKIT_URL or not Config.LIVEKIT_API_KEY or not Config.LIVEKIT_API_SECRET:
        return _json_error("LiveKit não está configurado no servidor.", 503)
    try:
        db = get_supabase()
        room_code = _room_code()
        existing = db.table("live_rooms").select("*").eq("room_code", room_code).limit(1).execute()
        host_secret = secrets.token_urlsafe(32)
        row = {
            "room_code": room_code,
            "password_hash": generate_password_hash(password),
            "host_token_hash": _hash_secret(host_secret),
            "is_locked": False,
            "is_active": True,
        }
        if existing.data:
            room_id = existing.data[0]["id"]
            db.table("live_rooms").update(row).eq("id", room_id).execute()
        else:
            inserted = db.table("live_rooms").insert(row).execute()
            room_id = inserted.data[0]["id"]
        token = create_access_token(room_code, identity, can_publish=True)
        return jsonify({
            "room": room_code,
            "host_secret": host_secret,
            "token": token,
            "server_url": Config.LIVEKIT_URL,
            "role": "host",
        })
    except Exception as exc:
        app.logger.exception("Falha ao criar live")
        return _json_error("Não foi possível criar a live. Verifique as permissões do Supabase e as configurações do servidor.", 500)

@app.post("/api/live/join")
def join_live():
    """Validate the room password and issue a subscriber token."""
    data = request.get_json(silent=True) or {}
    password = str(data.get("password", "")).strip()
    identity = str(data.get("identity", "viewer")).strip()[:60]
    if not Config.LIVEKIT_URL or not Config.LIVEKIT_API_KEY or not Config.LIVEKIT_API_SECRET:
        return _json_error("LiveKit não está configurado no servidor.", 503)
    try:
        db = get_supabase()
        result = db.table("live_rooms").select("room_code,password_hash,is_locked,is_active").eq("room_code", _room_code()).eq("is_active", True).limit(1).execute()
        if not result.data:
            return _json_error("Não existe transmissão ativa.", 404)
        room = result.data[0]
        role = "viewer"
        admin_token = str(data.get("admin_token", ""))
        if admin_token:
            try:
                claims = _admin_serializer().loads(admin_token, max_age=3600)
            except (BadSignature, SignatureExpired):
                return _json_error("Sessão administrativa inválida ou expirada.", 403)
            if claims.get("room") != room["room_code"] or claims.get("role") != "admin":
                return _json_error("Sessão administrativa não autorizada para esta live.", 403)
            role = "admin"
        elif room.get("is_locked") and not check_password_hash(room["password_hash"], password):
            return _json_error("Senha incorreta ou live protegida.", 403)
        token = create_access_token(room["room_code"], identity, can_publish=False)
        return jsonify({"room": room["room_code"], "token": token, "server_url": Config.LIVEKIT_URL, "role": role})
    except Exception:
        app.logger.exception("Falha ao entrar na live")
        return _json_error("Não foi possível validar o acesso à live.", 500)


@app.post("/api/live/admin-auth")
def admin_auth():
    """Validate the master password and issue a short-lived admin session for the active live."""
    data = request.get_json(silent=True) or {}
    password = str(data.get("password", ""))
    if not Config.ADMIN_MASTER_PASSWORD:
        return _json_error("A senha mestre não está configurada no servidor.", 503)
    if not secrets.compare_digest(password, Config.ADMIN_MASTER_PASSWORD):
        return _json_error("Senha administrativa incorreta.", 403)
    try:
        db = get_supabase()
        result = db.table("live_rooms").select("room_code,is_active").eq("room_code", _room_code()).eq("is_active", True).limit(1).execute()
        if not result.data:
            return _json_error("Não existe transmissão ativa.", 404)
        room_code = result.data[0]["room_code"]
        token = _admin_serializer().dumps({"room": room_code, "role": "admin"})
        return jsonify({"admin_token": token, "room": room_code, "expires_in": 3600})
    except Exception:
        app.logger.exception("Falha ao autenticar administrador")
        return _json_error("Não foi possível autenticar o administrador.", 500)

@app.post("/api/live/admin-verify")
def admin_verify():
    data = request.get_json(silent=True) or {}
    token = str(data.get("admin_token", ""))
    try:
        claims = _admin_serializer().loads(token, max_age=3600)
    except (BadSignature, SignatureExpired):
        return _json_error("Sessão administrativa inválida ou expirada.", 403)
    if claims.get("room") != _room_code() or claims.get("role") != "admin":
        return _json_error("Sessão administrativa inválida.", 403)
    try:
        db = get_supabase()
        active = db.table("live_rooms").select("id").eq("room_code", _room_code()).eq("is_active", True).limit(1).execute()
        if not active.data:
            return _json_error("A transmissão não está mais ativa.", 404)
        return jsonify({"valid": True})
    except Exception:
        app.logger.exception("Falha ao verificar sessão administrativa")
        return _json_error("Não foi possível verificar a sessão administrativa.", 500)

@app.post("/api/live/end")
def end_live():
    """Deactivate current live. Host authorization will be strengthened before production."""
    data = request.get_json(silent=True) or {}
    host_secret = str(data.get("host_secret", ""))
    if not host_secret:
        return _json_error("Credencial do anfitrião ausente.", 401)
    try:
        db = get_supabase()
        result = db.table("live_rooms").select("id,host_token_hash").eq("room_code", _room_code()).eq("is_active", True).limit(1).execute()
        if not result.data or not secrets.compare_digest(result.data[0]["host_token_hash"], _hash_secret(host_secret)):
            return _json_error("Credencial do anfitrião inválida.", 403)
        db.table("live_rooms").update({"is_active": False}).eq("id", result.data[0]["id"]).execute()
        return jsonify({"status": "ended"})
    except Exception:
        app.logger.exception("Falha ao encerrar live")
        return _json_error("Não foi possível encerrar a live.", 500)

@app.post("/api/live/lock")
def lock_live():
    data = request.get_json(silent=True) or {}
    host_secret = str(data.get("host_secret", ""))
    locked = bool(data.get("locked", False))
    if not host_secret:
        return _json_error("Credencial do anfitrião ausente.", 401)
    try:
        db = get_supabase()
        result = db.table("live_rooms").select("id,host_token_hash").eq("room_code", _room_code()).eq("is_active", True).limit(1).execute()
        if not result.data or not secrets.compare_digest(result.data[0]["host_token_hash"], _hash_secret(host_secret)):
            return _json_error("Credencial do anfitrião inválida.", 403)
        db.table("live_rooms").update({"is_locked": locked}).eq("id", result.data[0]["id"]).execute()
        return jsonify({"status": "ok", "locked": locked})
    except Exception:
        app.logger.exception("Falha ao alterar bloqueio da live")
        return _json_error("Não foi possível alterar o bloqueio da live.", 500)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
