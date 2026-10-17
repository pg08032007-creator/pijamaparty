// Confere um PIX direto no Mercado Pago (plano B caso o webhook demore).
// Chamada pelo app: db.functions.invoke("check-pix-payment", { body: { request_id } })
// @ts-nocheck  (Deno: tipos do runtime do Supabase)
import { corsHeaders, getCaller, json, mpFetchPayment, serviceClient, settlePayment } from "../_shared/mp.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = serviceClient();
    const user = await getCaller(admin, req);
    if (!user) return json({ error: "unauthorized" }, 401);

    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id) return json({ error: "bad_request" }, 400);

    const { data: row } = await admin.from("pix_requests").select("*")
      .eq("id", request_id).eq("user_id", user.id).maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);

    if (row.status === "pending" && row.mp_payment_id) {
      const payment = await mpFetchPayment(row.mp_payment_id);
      if (payment) await settlePayment(admin, payment);
    }

    const { data: fresh } = await admin.from("pix_requests").select("id, status, mp_status, amount").eq("id", row.id).single();
    return json({ request_id: fresh.id, status: fresh.status, mp_status: fresh.mp_status, amount: fresh.amount });
  } catch (e) {
    console.error("check-pix-payment:", e);
    return json({ error: "internal" }, 500);
  }
});
