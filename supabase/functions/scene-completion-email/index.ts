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

  const payload = {
    from: fromEmail,
    to: [toEmail],
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
    <p style="color:#687386;font-size:13px">L'équipe Stand-ING</p>
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
    <p style="color:#687386;font-size:13px">L'équipe Stand-ING</p>
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
  </div>`;
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
