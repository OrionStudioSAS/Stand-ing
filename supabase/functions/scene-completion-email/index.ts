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
  const purchaseOrder = normalizeEmailAttachment(body.purchaseOrder, "bon-de-commande.pdf");
  const technicalPlan = normalizeEmailAttachment(body.technicalPlan, "bat-scene.png");
  const mode = clean(body.mode) || 'completed';
  const requestedSpecialText = clean(body.specialRequest);
  if (!sceneId && !shareToken) return json({ error: "Missing scene identifier" }, 400);

  let query = supabase.from("scenes").select("id, share_token, client_name, client_email, project_name, event_name, salon, offer, source_payload").limit(1);
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
  const clientName = contactFullName(scene) || clean(scene.client_name) || clean(scene.source_payload?.exhibitor_name) || "client";
  const standName = clean(scene.project_name) || "votre stand";
  const eventName = clean(scene.event_name) || clean(scene.salon) || "Stand-ING";
  const offerName = standOfferLabel(scene);
  const specialRequest = requestedSpecialText || clean(scene.source_payload?.specialRequest?.text);
  const emailContent = buildEmailContent({ mode, clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder: Boolean(purchaseOrder), specialRequest });

  const notifyAdmin = mode === 'completed' || mode === 'special_request_completed';
  const payload = {
    from: fromEmail,
    to: [toEmail],
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    ...(purchaseOrder ? { attachments: [purchaseOrder] } : {}),
  };

  const response = await sendResendEmail(resendApiKey, payload);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: result?.message || "Email sending failed", details: result }, 502);

  let adminResult: Record<string, unknown> | null = null;
  if (notifyAdmin && completionNotifyTo && completionNotifyTo !== toEmail) {
    const adminPayload = {
      from: fromEmail,
      to: [completionNotifyTo],
      subject: `[BAT + BDC${offerName ? ` ${offerName}` : ""}] Configuration ${standName} confirmée`,
      html: adminNotificationEmailHtml({ clientName, toEmail, standName, eventName, offerName, sceneUrl, mode, hasTechnicalPlan: Boolean(technicalPlan), hasPurchaseOrder: Boolean(purchaseOrder) }),
      text: `Configuration confirmée\n\nExposant : ${clientName}\nEmail : ${toEmail}\nStand : ${standName}\nSalon : ${eventName}${offerName ? `\nFormule : Stand ${offerName}` : ""}\nLien : ${sceneUrl}\n\nPièces jointes :${technicalPlan ? "\n- BAT" : "\n- BAT non généré"}${purchaseOrder ? "\n- Bon de commande" : "\n- Bon de commande non généré"}`,
      ...((technicalPlan || purchaseOrder) ? { attachments: [technicalPlan, purchaseOrder].filter(Boolean) } : {}),
    };
    const adminResponse = await sendResendEmail(resendApiKey, adminPayload);
    adminResult = await adminResponse.json().catch(() => ({}));
    if (!adminResponse.ok) {
      console.error("Admin completion email failed", adminResult);
    }
  }

  await supabase.from("scenes").update({
    source_payload: {
      ...(scene.source_payload || {}),
      completion_email_sent_at: new Date().toISOString(),
      completion_email_to: toEmail,
      completion_email_admin_copy_to: notifyAdmin ? completionNotifyTo : "",
      last_completion_email_mode: mode,
    },
  }).eq("id", scene.id);

  return json({ sent: true, to: maskEmail(toEmail), admin_to: notifyAdmin && completionNotifyTo ? maskEmail(completionNotifyTo) : null, provider_id: result?.id || null, admin_provider_id: adminResult?.id || null });
});

function sendResendEmail(resendApiKey: string, payload: Record<string, unknown>) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function buildEmailContent({ mode, clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder, specialRequest }: { mode: string; clientName: string; standName: string; eventName: string; offerName: string; sceneUrl: string; hasPurchaseOrder: boolean; specialRequest: string }) {
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
    html: completionEmailHtml({ clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder }),
    text: completionEmailText({ clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder }),
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

function completionEmailHtml({ clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder }: { clientName: string; standName: string; eventName: string; offerName: string; sceneUrl: string; hasPurchaseOrder: boolean }) {
  const formula = offerName || "CONFORT";
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#1f4378;margin:0 0 12px">Votre configuration Stand-ING est confirmée</h2>
    <p>Bonjour ${escapeHtml(clientName)},</p>
    <p>La configuration de votre stand <strong>${escapeHtml(standName)}</strong> de votre formule <strong>${escapeHtml(formula)}</strong> est confirmée pour <strong>${escapeHtml(eventName)}</strong>.</p>
    ${hasPurchaseOrder ? "<p>Vous trouverez votre bon de commande joint à cet email.</p>" : ""}
    <p><strong>Et maintenant ?</strong> Un membre de notre équipe reviendra vers vous rapidement pour vous guider pour la suite.</p>
    <p>Vous pouvez consulter votre scène à tout moment depuis le lien ci-dessous :</p>
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Voir ma configuration</a></p>
    <p>Merci et à très vite.</p>

    <hr style="border:0;border-top:1px solid #d7dde8;margin:24px 0" />

    <p>Hello ${escapeHtml(clientName)},</p>
    <p>The configuration of your stand <strong>${escapeHtml(standName)}</strong> for your <strong>${escapeHtml(formula)}</strong> package is confirmed for <strong>${escapeHtml(eventName)}</strong>.</p>
    ${hasPurchaseOrder ? "<p>You will find your purchase order attached to this email.</p>" : ""}
    <p><strong>What happens next?</strong> A member of our team will get back to you shortly to guide you through the next steps.</p>
    <p>You can view your scene at any time from the link below:</p>
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">View my configuration</a></p>
    <p>Thank you and see you soon.</p>
    ${emailSignatureHtml()}
  </div>`;
}

function completionEmailText({ clientName, standName, eventName, offerName, sceneUrl, hasPurchaseOrder }: { clientName: string; standName: string; eventName: string; offerName: string; sceneUrl: string; hasPurchaseOrder: boolean }) {
  const formula = offerName || "CONFORT";
  return `Bonjour ${clientName},

La configuration de votre stand ${standName} de votre formule ${formula} est confirmée pour ${eventName}.

${hasPurchaseOrder ? "Vous trouverez votre bon de commande joint à cet email.\n" : ""}Et maintenant ? Un membre de notre équipe reviendra vers vous rapidement pour vous guider pour la suite.
Vous pouvez consulter votre scène à tout moment depuis le lien ci-dessous :
Voir ma configuration - ${sceneUrl}

Merci et à très vite.

____________________________________________________

Hello ${clientName},

The configuration of your stand ${standName} for your ${formula} package is confirmed for ${eventName}.

${hasPurchaseOrder ? "You will find your purchase order attached to this email.\n" : ""}What happens next? A member of our team will get back to you shortly to guide you through the next steps.
You can view your scene at any time from the link below:
View my configuration - ${sceneUrl}

Thank you and see you soon.

${emailSignatureText()}`;
}

function adminNotificationEmailHtml({ clientName, toEmail, standName, eventName, offerName, sceneUrl, mode, hasTechnicalPlan, hasPurchaseOrder }: { clientName: string; toEmail: string; standName: string; eventName: string; offerName: string; sceneUrl: string; mode: string; hasTechnicalPlan: boolean; hasPurchaseOrder: boolean }) {
  const title = mode === "special_request_completed" ? "Demande spécifique traitée" : "Configuration exposant confirmée";
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2 style="color:#1f4378;margin:0 0 12px">${escapeHtml(title)}</h2>
    <p>L'exposant vient de terminer sa configuration.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0;background:#f4f7fb;border-radius:10px;overflow:hidden">
      <tr><td style="padding:8px 12px;color:#687386">Exposant</td><td style="padding:8px 12px;font-weight:bold">${escapeHtml(clientName)}</td></tr>
      <tr><td style="padding:8px 12px;color:#687386">Email</td><td style="padding:8px 12px;font-weight:bold">${escapeHtml(toEmail)}</td></tr>
      <tr><td style="padding:8px 12px;color:#687386">Stand</td><td style="padding:8px 12px;font-weight:bold">${escapeHtml(standName)}</td></tr>
      <tr><td style="padding:8px 12px;color:#687386">Salon</td><td style="padding:8px 12px;font-weight:bold">${escapeHtml(eventName)}</td></tr>
      ${offerName ? `<tr><td style="padding:8px 12px;color:#687386">Formule</td><td style="padding:8px 12px;font-weight:bold">Stand ${escapeHtml(offerName)}</td></tr>` : ""}
    </table>
    <p>Pièces jointes :</p>
    <ul>
      <li>${hasTechnicalPlan ? "BAT joint" : "BAT non généré automatiquement"}</li>
      <li>${hasPurchaseOrder ? "Bon de commande joint" : "Bon de commande non généré automatiquement"}</li>
    </ul>
    <p><a href="${sceneUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Ouvrir la scène</a></p>
    ${emailSignatureHtml()}
  </div>`;
}

function standOfferLabel(scene: any) {
  const raw = clean(scene.offer || scene.source_payload?.offer || scene.source_payload?.pack || scene.source_payload?.formule || scene.source_payload?.offerName || scene.source_payload?.packName);
  const normalized = clean(raw).toLowerCase();
  if (normalized.includes("prestige")) return "PRESTIGE";
  if (normalized.includes("confort")) return "CONFORT";
  return raw;
}

function contactFullName(scene: any) {
  const contact = scene?.source_payload?.contactDetails || {};
  const firstName = clean(contact.firstName || contact.firstname || contact.first_name || scene?.source_payload?.firstName || scene?.source_payload?.first_name);
  const lastName = clean(contact.lastName || contact.lastname || contact.last_name || scene?.source_payload?.lastName || scene?.source_payload?.last_name).toUpperCase();
  return clean([firstName, lastName].filter(Boolean).join(" "));
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
function normalizeEmailAttachment(value: any, fallbackName: string) {
  const content = clean(value?.contentBase64);
  if (!content || !/^[A-Za-z0-9+/=\s]+$/.test(content)) return null;
  const filename = clean(value?.filename).replace(/[^\w.\-]+/g, "-") || fallbackName;
  return {
    filename,
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
