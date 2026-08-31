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
  const offerLabel = sceneOfferLabel(scene);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [questionTo],
      reply_to: clientEmail || undefined,
      subject: `[Stand-ING] ${subject}`,
      html: questionEmailHtml({ scene, clientName, clientEmail, offerLabel, subject, message, sceneUrl, category: clean(body.category), urgency: clean(body.urgency) }),
      text: `Question / remarque Stand-ING\n\nExposant: ${clientName}\nEmail: ${clientEmail || "-"}\nSalon: ${scene.salon || scene.event_name || "-"}\nFormule: ${offerLabel || "-"}\nStand: ${scene.project_name || "-"}\nCatégorie: ${clean(body.category) || "-"}\nUrgence: ${clean(body.urgency) || "-"}\n\nObjet: ${subject}\n\n${message || "(aucun message)"}\n\nScène: ${sceneUrl}`,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: payload?.message || "Email not sent" }, 502);
  return json({ sent: true, to: questionTo, id: payload?.id || null });
});

function questionEmailHtml({ scene, clientName, clientEmail, offerLabel, subject, message, sceneUrl, category, urgency }: any) {
  return `
  <div style="font-family:Arial,sans-serif;color:#182033;line-height:1.5">
    <h2>Question / remarque configurateur</h2>
    <p><strong>Exposant :</strong> ${escapeHtml(clientName)}</p>
    <p><strong>Email :</strong> ${escapeHtml(clientEmail || "-")}</p>
    <p><strong>Salon :</strong> ${escapeHtml(scene.salon || scene.event_name || "-")}</p>
    <p><strong>Formule :</strong> ${escapeHtml(offerLabel || "-")}</p>
    <p><strong>Stand :</strong> ${escapeHtml(scene.project_name || "-")}</p>
    <p><strong>Catégorie :</strong> ${escapeHtml(category || "-")} — <strong>Urgence :</strong> ${escapeHtml(urgency || "-")}</p>
    <hr />
    <p><strong>Objet :</strong> ${escapeHtml(subject)}</p>
    <p style="white-space:pre-wrap;background:#f4f7fb;border-radius:12px;padding:14px">${escapeHtml(message || "(aucun message)")}</p>
    <p><a href="${escapeHtml(sceneUrl)}" style="display:inline-block;background:#1f4378;color:white;text-decoration:none;padding:10px 14px;border-radius:8px">Voir la scène</a></p>
    ${emailSignatureHtml()}
  </div>`;
}

function emailSignatureHtml() {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #d7dde8;padding-top:14px;font-family:Arial,sans-serif;color:#172033;line-height:1.35">
      <tr>
        <td style="padding:0 0 4px;font-size:11pt;font-weight:bold;color:#002060">Contact exposant</td>
      </tr>
      <tr>
        <td style="padding:0 0 12px;font-size:10pt;color:#767171">
          <a href="mailto:configurateur@stand-ing.com" style="color:#767171;text-decoration:none">configurateur@stand-ing.com</a>
          <span style="color:#767171"> | +33 (0)1 34 64 64 13</span>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 4px;font-size:11pt;font-weight:bold;color:#002060">Stand-ING | LA FORCE BLEUE</td>
      </tr>
      <tr>
        <td style="padding:0 0 12px;font-size:10pt;color:#767171">
          2 Rue de la Métairie - 95640 MARINES<br />
          T : +33 (0)1 34 30 46 62<br />
          <a href="https://www.stand-ing.com" style="color:#767171;text-decoration:none">www.stand-ing.com</a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 12px">
          <img src="https://mail.stand-ing.com/img/mail/signature-00.png" width="151" height="220" alt="Stand-ING" style="display:inline-block;border:0;vertical-align:top" />
          <img src="https://mail.stand-ing.com/img/mail/signature-02.png" width="360" height="220" alt="EXPOSITION | EVENEMENTIEL | AGENCEMENT" style="display:inline-block;border:0;vertical-align:top" />
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 12px">
          <img src="https://mail.stand-ing.com/img/mail/icone1.png" width="128" height="34" alt="" style="display:inline-block;border:0;vertical-align:middle" />
          <a href="https://www.linkedin.com/company/stand-ing/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone6.png" width="36" height="34" alt="LinkedIn" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.instagram.com/standing_officiel/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone7.png" width="36" height="34" alt="Instagram" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.facebook.com/standing95/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone2.png" width="36" height="34" alt="Facebook" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.youtube.com/channel/UCB_U0sKwdannk3HAowNHlZA" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone3.png" width="36" height="34" alt="Youtube" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://fr.pinterest.com/ing2355/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone4.png" width="36" height="34" alt="Pinterest" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.stand-ing.com" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone5.png" width="36" height="34" alt="stand-ing.com" style="display:inline-block;border:0;vertical-align:middle" /></a>
        </td>
      </tr>
      <tr>
        <td>
          <img src="https://mail.stand-ing.com/img/mail/pub2.png" width="320" height="75" alt="" style="display:block;border:0" />
        </td>
      </tr>
    </table>`;
}

function emailSignatureText() {
  return `Contact exposant
configurateur@stand-ing.com | +33 (0)1 34 64 64 13

Stand-ING | LA FORCE BLEUE
2 Rue de la Métairie - 95640 MARINES
T : +33 (0)1 34 30 46 62
www.stand-ing.com`;
}
function sceneOfferLabel(scene: any = {}) {
  const raw = clean(scene.offer)
    || clean(scene.source_payload?.offer)
    || clean(scene.source_payload?.pack)
    || clean(scene.source_payload?.pricing?.offer)
    || clean(scene.source_payload?.pricing?.pack);
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("prestige")) return "PRESTIGE";
  if (normalized.includes("confort")) return "CONFORT";
  return raw.toUpperCase();
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
