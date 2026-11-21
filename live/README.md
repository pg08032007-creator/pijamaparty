# PartyLives

Projeto reorganizado para preparar a migração da mídia P2P (PeerJS) para LiveKit Cloud.

## Estrutura

- `frontend/`: interface atual (HTML, CSS, JavaScript e imagens), preservada.
- `backend/`: configuração e serviços de integração com Supabase e LiveKit.
- `app.py`: servidor Flask local que entrega o frontend e expõe `/api/health`.
- `requirements.txt`: dependências Python.
- `.env.example`: modelo de variáveis secretas.

## Executar localmente

1. Crie e ative um ambiente virtual:
   - Windows: `py -3.13 -m venv .venv`
   - PowerShell: `.venv\\Scripts\\Activate.ps1`
2. Instale as dependências:
   `pip install -r requirements.txt`
3. Copie `.env.example` para `.env` e preencha os valores localmente.
4. Inicie:
   `python app.py`
5. Abra `http://127.0.0.1:5000`.

O endpoint `http://127.0.0.1:5000/api/health` deve responder com `{"status":"ok","service":"PartyLives backend"}`.

## Segurança e estado da migração

- Nunca coloque `SUPABASE_SECRET_KEY` ou `LIVEKIT_API_SECRET` no frontend.
- Nunca versione o arquivo `.env`.
- Os módulos `backend/services/` fornecem funções para conectar ao Supabase e emitir tokens LiveKit.
- **A transmissão do frontend ainda usa PeerJS nesta etapa.** A troca para LiveKit, validação de senha no servidor, banimentos no banco e emissão autenticada de tokens serão implementadas e testadas na próxima etapa. Não publique o backend como serviço de produção antes dessa autorização estar implementada.
- O SQL inicial criado no Supabase contém `live_rooms` e `banned_viewers`. A integração efetiva com essas tabelas ainda está pendente.


## Etapa 1 — endpoints iniciais de autorização LiveKit

- `POST /api/live/create`: cria/ativa a sala única e emite token de anfitrião.
- `POST /api/live/join`: valida acesso e emite token de espectador.
- `POST /api/live/end`: encerra a sala com credencial temporária do anfitrião.

**Atenção:** os endpoints são uma base de integração e ainda não substituem o fluxo PeerJS do frontend. A validação de senha de entrada respeita `is_locked`; a política de sala aberta/fechada e a autorização de host serão concluídas junto da migração do frontend. Não publicar em produção antes de adicionar rate limiting, autenticação/CSRF conforme o modelo de hospedagem e testes de concorrência.


## Etapa 2 — mídia via LiveKit (integração inicial)

- O frontend carrega o SDK UMD `livekit-client`.
- O anfitrião solicita token ao Flask e publica as tracks locais no LiveKit.
- O espectador solicita token ao Flask e assina as tracks publicadas.
- PeerJS permanece somente para canal de controle/chat nesta etapa; chamadas de mídia PeerJS são rejeitadas.
- O bloqueio da sala é persistido pelo endpoint `/api/live/lock`.

**Validação necessária:** teste em dois navegadores com HTTPS ou localhost. Essa etapa ainda não migra o canal de chat/controle, nem implementa persistência server-side completa de banimentos. Não publicar em produção sem teste de mídia, revisão de autorização e proteção contra abuso.


## Modo administrador por senha mestre

- Ao tentar entrar em uma live trancada, a senha mestre definida em `ADMIN_MASTER_PASSWORD` no `.env` autentica o modo administrador.
- A senha mestre não fica no JavaScript; a validação é feita no Flask e gera uma sessão assinada com validade de 1 hora.
- O administrador recebe controles para banir espectadores, criar/girar a roleta, publicar enquetes e silenciar/reativar o microfone e a câmera da transmissão.
- Para configurar, adicione ao `.env`: `ADMIN_MASTER_PASSWORD=kakaushow`. Não coloque essa senha no `.env.example` real nem versione o `.env`.
- Reinicie o Flask depois de alterar o `.env`.

**Importante:** `kakaushow` é uma senha mestre global. Qualquer pessoa que a conheça poderá administrar qualquer live ativa trancada. Troque-a se houver suspeita de exposição. Antes de produção, adicione rate limiting persistente ao endpoint de autenticação administrativa e conclua a persistência de banimentos no Supabase.
