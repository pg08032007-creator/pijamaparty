// Ações de administrador sobre contas (criar usuário, trocar senha).
// Só funciona se quem chama tiver profiles.is_admin = true (verificado no servidor).
// @ts-nocheck  (Deno: tipos do runtime do Supabase)
import { corsHeaders, getCaller, json, serviceClient } from "../_shared/mp.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = serviceClient();
    const caller = await getCaller(admin, req);
    if (!caller) return json({ error: "unauthorized" }, 401);

    const { data: me } = await admin.from("profiles").select("is_admin, is_banned").eq("id", caller.id).maybeSingle();
    if (!me?.is_admin || me.is_banned) return json({ error: "forbidden", message: "Apenas administradores." }, 403);

    const body = await req.json().catch(() => ({}));

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const username = String(body.username || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email", message: "E-mail inválido." }, 400);
      if (password.length < 8) return json({ error: "weak_password", message: "Use uma senha com 8+ caracteres." }, 400);
      if (!/^[a-z0-9_.]{3,20}$/.test(username)) return json({ error: "bad_username", message: "Usuário: 3 a 20 caracteres (letras, números, _ ou .)." }, 400);

      const { data: taken } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
      if (taken) return json({ error: "username_taken", message: "Esse nome de usuário já existe." }, 409);

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { username, gender: body.gender || "Outro" },
      });
      if (error) return json({ error: "create_failed", message: error.message }, 400);

      // o gatilho do banco já cria o perfil; aqui só aplicamos os cargos pedidos
      await new Promise((r) => setTimeout(r, 300));
      await admin.from("profiles").update({
        is_admin: !!body.is_admin,
        is_verified: !!body.is_verified,
        is_developer: !!body.is_developer,
      }).eq("id", data.user.id);

      return json({ ok: true, id: data.user.id });
    }

    if (body.action === "set_password") {
      const id = String(body.user_id || "");
      const password = String(body.password || "");
      if (!id) return json({ error: "bad_request" }, 400);
      if (password.length < 8) return json({ error: "weak_password", message: "Use uma senha com 8+ caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: "update_failed", message: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("admin-users:", e);
    return json({ error: "internal" }, 500);
  }
});
