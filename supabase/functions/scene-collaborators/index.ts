import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sceneActor, sceneEmail } from "../_shared/scenePermissions.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const columns = "id, email, accepted_at, expires_at";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = await sceneActor(admin, req);
  if (!user) return json({ error: "Accès refusé." }, 401);
  const body = await req.json().catch(() => ({}));
  if (typeof body.scene_id !== "string") return json({ error: "Scène introuvable." }, 400);
  const { data: scene } = await admin.from("scenes")
    .select("id, client_email, project_name, event_name, salon").eq("id", body.scene_id).maybeSingle();
  if (!scene || sceneEmail(user.email) !== sceneEmail(scene.client_email)) {
    return json({ error: "Seul le contact principal peut gérer les invitations." }, 403);
  }

  if (body.action === "list") {
    const { data, error } = await admin.from("scene_collaborators").select(columns).eq("scene_id", scene.id).order("slot");
    return error ? json({ error: "Impossible de charger les invitations." }, 500) : json({ members: data });
  }
  if (body.action === "remove") {
    if (typeof body.invitation_id !== "string") return json({ error: "Invitation introuvable." }, 400);
    const { error } = await admin.from("scene_collaborators").delete()
      .eq("id", body.invitation_id).eq("scene_id", scene.id);
    return error ? json({ error: "Impossible de retirer cet accès." }, 400) : json({ removed: true });
  }
  if (body.action !== "invite") return json({ error: "Action inconnue." }, 400);

  const email = sceneEmail(body.email);
  if (typeof body.email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Saisissez une adresse e-mail valide." }, 400);
  }
  if (email === sceneEmail(scene.client_email)) return json({ error: "Cette adresse est déjà le contact principal." }, 409);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "L’envoi des invitations n’est pas configuré." }, 503);
  const { data: members, error: readError } = await admin.from("scene_collaborators").select("slot,email").eq("scene_id", scene.id);
  if (readError) return json({ error: "Impossible de charger les invitations." }, 500);
  if (members.some((member) => member.email === email)) return json({ error: "Cette adresse est déjà invitée." }, 409);
  let invitation = null;
  for (const slot of [1, 2]) {
    if (members.some((member) => member.slot === slot)) continue;
    const { data, error } = await admin.from("scene_collaborators").insert({ scene_id: scene.id, email, slot }).select(columns).single();
    if (data) { invitation = data; break; }
    if (error?.code !== "23505") return json({ error: "Impossible de créer l’invitation." }, 500);
  }
  if (!invitation) return json({ error: "Deux collaborateurs maximum par scène." }, 409);

  const english = body.language === "en";
  try {
    const url = new URL(Deno.env.get("PUBLIC_APP_URL") || "https://configurateur3d.stand-ing.com/");
    url.searchParams.set("invite", invitation.id);
    if (english) url.searchParams.set("lang", "en");
    const stand = scene.project_name || scene.event_name || scene.salon || "Stand-ING";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "Stand-ING <no-reply@stand-ing.com>",
        to: [email],
        subject: english ? "Invitation to collaborate on a Stand-ING stand" : "Invitation à collaborer sur un stand Stand-ING",
        text: english
          ? `You have been invited to edit and submit the configuration for ${stand}. Open your personal link and verify your email within 7 days:\n\n${url}`
          : `Vous êtes invité à modifier et à valider la configuration de ${stand}. Ouvrez votre lien personnel et vérifiez votre adresse e-mail dans les 7 jours :\n\n${url}`,
      }),
    });
    if (!response.ok) throw new Error(`Email provider: ${response.status}`);
  } catch (error) {
    console.error("Scene invitation delivery failed", error);
    await admin.from("scene_collaborators").delete().eq("id", invitation.id).is("accepted_at", null);
    return json({ error: "Impossible d’envoyer l’invitation. Réessayez." }, 502);
  }
  return json({ member: invitation }, 201);
});
