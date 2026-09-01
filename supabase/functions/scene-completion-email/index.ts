import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Stand-ING <no-reply@stand-ing.com>";
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://stand-ing.vercel.app/";
  const completionNotifyTo = clean(Deno.env.get("COMPLETION_NOTIFICATION_EMAIL") || "configurateur@stand-ing.com").toLowerCase();

  if (!resendApiKey) return json({ sent: false, reason: "Missing RESEND_API_KEY" }, 200);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({}));
  const sceneId = clean(body.sceneId);
  const shareToken = clean(body.shareToken);
  const purchaseOrder = normalizePurchaseOrderAttachment(body.purchaseOrder);
  const mode = clean(body.mode) || 'completed';
  const requestedSpecialText = clean(body.specialRequest);
  if (!sceneId && !shareToken) return json({ error: "Missing scene identifier" }, 400);

  let query = supabase.from("scenes").select("id, share_token, client_name, client_email, project_name, event_name, salon, source_payload").limit(1);
  query = sceneId ? query.eq("id", sceneId) : query.eq("share_token", shareToken);
  const { data: scenes, error } = await query;
  if (error) return json({ error: error.message }, 500);
  const scene = scenes?.[0];
  if (!scene) return json({ error: "Scene not found" }, 404);

  const accessToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const authData = accessToken ? (await supabase.auth.getUser(accessToken)).data : null;
  const userId = authData?.user?.id || "";
  const userEmail = clean(authData?.user?.email).toLowerCase();
  const { data: adminUser } = userId
    ? await supabase.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle()
    : { data: null };
  const isAdmin = Boolean(adminUser);
  const isSceneOwner = userEmail && userEmail === clean(scene.client_email).toLowerCase();
  const hasShareToken = shareToken && shareToken === scene.share_token;
  if (!isAdmin && !isSceneOwner && !hasShareToken) return json({ error: "Forbidden" }, 403);

  const toEmail = clean(scene.client_email).toLowerCase();
  if (!toEmail) return json({ sent: false, reason: "Scene has no client email" }, 200);

  const sceneUrl = `${publicAppUrl.replace(/\/$/, "")}/?scene=${encodeURIComponent(scene.share_token)}`;
  const clientName = clean(scene.client_name) || clean(scene.source_payload?.exhibitor_name) || "client";
  const standName = clean(scene.project_name) || "votre stand";
  const eventName = clean(scene.event_name) || clean(scene.salon) || "Stand-ING";
  const specialRequest = requestedSpecialText || clean(scene.source_payload?.specialRequest?.text);
  const emailContent = buildEmailContent({ mode, clientName, standName, eventName, sceneUrl, hasPurchaseOrder: Boolean(purchaseOrder), specialRequest });

  const notifyAdmin = mode === 'completed' || mode === 'special_request_completed';
  const adminCopy = notifyAdmin && completionNotifyTo && completionNotifyTo !== toEmail ? [completionNotifyTo] : [];
  const payload = {
    from: fromEmail,
    to: [toEmail],
    ...(adminCopy.length ? { bcc: adminCopy } : {}),
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    ...(purchaseOrder ? { attachments: [purchaseOrder] } : {}),
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: result?.message || "Email sending failed", details: result }, 502);

  await supabase.from("scenes").update({
    source_payload: {
      ...(scene.source_payload || {}),
      completion_email_sent_at: new Date().toISOString(),
      completion_email_to: toEmail,
      completion_email_admin_copy_to: adminCopy[0] || '',
      last_completion_email_mode: mode,
    },
  }).eq("id", scene.id);

  return json({ sent: true, to: maskEmail(toEmail), provider_id: result?.id || null });
});

function buildEmailContent({ mode, clientName, standName, eventName, sceneUrl, hasPurchaseOrder, specialRequest }: { mode: string; clientName: string; standName: string; eventName: string; sceneUrl: string; hasPurchaseOrder: boolean; specialRequest: string }) {
  if (mode === "special_request_received") {
    return {
      subject: `Demande spécifique reçue pour ${standName}`,
      html: specialRequestReceivedEmailHtml({ clientName, standName, eventName, sceneUrl, specialRequest }),
      text: `Bonjour ${clientName},\n\nVotre configuration ${standName} pour ${eventName} a bien été sauvegardée.\nNous allons prendre en compte votre demande : ${specialRequest}\n\nNotre équipe revient vers vous sous 2 jours ouvrés avec les modifications réalisées sur votre scène.\nLien de votre scène : ${sceneUrl}\n\nL'équipe Stand-ING`,
    };
  }
  if (mode === "special_request_completed") {
    return {
      subject: `Modifications réalisées pour ${standName}`,
      html: specialRequestCompletedEmailHtml({ clientName, standName, eventName, sceneUrl, hasPurchaseOrder }),
      text: `Bonjour ${clientName},\n\nNotre équipe a réalisé les modifications demandées sur votre configuration ${standName} pour ${eventName}.\nVous pouvez consulter votre scène ici : ${sceneUrl}${hasPurchaseOrder ? "\n\nVotre bon de commande est joint à cet email." : ""}\n\nL'équipe Stand-ING`,
    };
  }
  return {
    subject: `Configuration ${standName} confirmée`,
    html: completionEmailHtml({ clientName, standName, eventName, sceneUrl, hasPurchaseOrder }),
    text: `Bonjour ${clientName},\n\nVotre configuration ${standName} pour ${eventName} a bien été confirmée.\nVous pouvez la consulter ici : ${sceneUrl}${hasPurchaseOrder ? "\n\nVotre bon de commande est joint à cet email." : ""}\n\nL'équipe Stand-ING`,
  };
}

function specialRequestReceivedEmailHtml({ clientName, standName, eventName, sceneUrl, specialRequest }: { clientName: string; standName: string; eventName: string; sceneUrl: string; specialRequest: string }) {
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#1f4378;margin:0 0 12px">Votre configuration Stand-ING est sauvegardée</h2>
    <p>Bonjour ${escapeHtml(clientName)},</p>
    <p>Votre configuration <strong>${escapeHtml(standName)}</strong> pour <strong>${escapeHtml(eventName)}</strong> a bien été sauvegardée.</p>
    <p>Nous allons prendre en compte votre demande :</p>
    <p style="background:#fff7df;border:1px solid #f5b42c;border-radius:10px;padding:12px;color:#8a5a00"><strong>${escapeHtml(specialRequest)}</strong></p>
    <p>Notre équipe revient vers vous sous <strong>2 jours ouvrés</strong> avec les modifications réalisées sur votre scène.</p>
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Voir ma configuration</a></p>
    ${emailSignatureHtml()}
  </div>`;
}

function specialRequestCompletedEmailHtml({ clientName, standName, eventName, sceneUrl, hasPurchaseOrder }: { clientName: string; standName: string; eventName: string; sceneUrl: string; hasPurchaseOrder: boolean }) {
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#1f4378;margin:0 0 12px">Vos modifications ont été réalisées</h2>
    <p>Bonjour ${escapeHtml(clientName)},</p>
    <p>Notre équipe a réalisé les modifications demandées sur votre configuration <strong>${escapeHtml(standName)}</strong> pour <strong>${escapeHtml(eventName)}</strong>.</p>
    ${hasPurchaseOrder ? "<p>Votre bon de commande est joint à cet email.</p>" : ""}
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Voir ma configuration</a></p>
    ${emailSignatureHtml()}
  </div>`;
}

function completionEmailHtml({ clientName, standName, eventName, sceneUrl, hasPurchaseOrder }: { clientName: string; standName: string; eventName: string; sceneUrl: string; hasPurchaseOrder: boolean }) {
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#1f4378;margin:0 0 12px">Votre configuration Stand-ING est confirmée</h2>
    <p>Bonjour ${escapeHtml(clientName)},</p>
    <p>Votre configuration <strong>${escapeHtml(standName)}</strong> pour <strong>${escapeHtml(eventName)}</strong> a bien été confirmée.</p>
    ${hasPurchaseOrder ? "<p>Votre bon de commande est joint à cet email.</p>" : ""}
    <p>Vous pouvez consulter votre scène à tout moment depuis le lien ci-dessous :</p>
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Voir ma configuration</a></p>
    <p style="color:#687386;font-size:13px">L'équipe Stand-ING reviendra vers vous pour les prochaines étapes si nécessaire.</p>
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
function normalizePurchaseOrderAttachment(value: any) {
  const content = clean(value?.contentBase64);
  if (!content || !/^[A-Za-z0-9+/=\s]+$/.test(content)) return null;
  const filename = clean(value?.filename).replace(/[^\w.\-]+/g, "-") || "bon-de-commande.pdf";
  return {
    filename: filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`,
    content: content.replace(/\s+/g, ""),
  };
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function escapeHtml(value: string) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
