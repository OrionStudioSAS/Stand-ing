import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Stand-ING <no-reply@stand-ing.com>";
  const questionTo = Deno.env.get("QUESTION_NOTIFICATION_EMAIL") || "configurateur@stand-ing.com";
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://stand-ing.vercel.app/";

  if (!resendApiKey) return json({ error: "Missing RESEND_API_KEY" }, 500);

  const body = await req.json().catch(() => ({}));
  const sceneId = clean(body.sceneId);
  const shareToken = clean(body.shareToken);
  if (!sceneId && !shareToken) return json({ error: "Scene missing" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const query = supabase.from("scenes").select("*").limit(1);
  const { data: scenes, error } = sceneId
    ? await query.eq("id", sceneId)
    : await query.eq("share_token", shareToken);
  if (error) return json({ error: error.message }, 500);
  const scene = scenes?.[0];
  if (!scene) return json({ error: "Scene not found" }, 404);

  const subject = clean(body.subject) || "Question configurateur";
  const message = clean(body.message);
  const sceneUrl = clean(body.sceneUrl) || `${publicAppUrl.replace(/\/+$/g, "")}/?scene=${encodeURIComponent(scene.share_token || scene.id)}`;
  const clientName = clean(scene.client_name) || clean(scene.source_payload?.contactDetails?.company) || "Exposant";
  const contact = scene.source_payload?.contactDetails || {};
  const clientEmail = clean(contact.email) || clean(scene.client_email);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [questionTo],
      reply_to: clientEmail || undefined,
      subject: `[Stand-ING] ${subject}`,
      html: questionEmailHtml({ scene, clientName, clientEmail, subject, message, sceneUrl, category: clean(body.category), urgency: clean(body.urgency) }),
      text: `Question / remarque Stand-ING\n\nExposant: ${clientName}\nEmail: ${clientEmail || "-"}\nSalon: ${scene.salon || scene.event_name || "-"}\nStand: ${scene.project_name || "-"}\nCatégorie: ${clean(body.category) || "-"}\nUrgence: ${clean(body.urgency) || "-"}\n\nObjet: ${subject}\n\n${message || "(aucun message)"}\n\nScène: ${sceneUrl}`,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: payload?.message || "Email not sent" }, 502);
  return json({ sent: true, to: questionTo, id: payload?.id || null });
});

function questionEmailHtml({ scene, clientName, clientEmail, subject, message, sceneUrl, category, urgency }: any) {
  return `
  <div style="font-family:Arial,sans-serif;color:#182033;line-height:1.5">
    <h2>Question / remarque configurateur</h2>
    <p><strong>Exposant :</strong> ${escapeHtml(clientName)}</p>
    <p><strong>Email :</strong> ${escapeHtml(clientEmail || "-")}</p>
    <p><strong>Salon :</strong> ${escapeHtml(scene.salon || scene.event_name || "-")}</p>
    <p><strong>Stand :</strong> ${escapeHtml(scene.project_name || "-")}</p>
    <p><strong>Catégorie :</strong> ${escapeHtml(category || "-")} — <strong>Urgence :</strong> ${escapeHtml(urgency || "-")}</p>
    <hr />
    <p><strong>Objet :</strong> ${escapeHtml(subject)}</p>
    <p style="white-space:pre-wrap;background:#f4f7fb;border-radius:12px;padding:14px">${escapeHtml(message || "(aucun message)")}</p>
    <p><a href="${escapeHtml(sceneUrl)}" style="display:inline-block;background:#1f4378;color:white;text-decoration:none;padding:10px 14px;border-radius:8px">Voir la scène</a></p>
  </div>`;
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
