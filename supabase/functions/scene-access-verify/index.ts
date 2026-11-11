import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findSceneInvitation, sceneEmail } from "../_shared/scenePermissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const { scene_token: sceneToken, invitation_token: invitationToken, code } = await req.json().catch(() => ({}));

  if (!(invitationToken || (sceneToken && typeof sceneToken === "string")) || !/^\d{6,10}$/.test(String(code || ""))) {
    return json({ error: "Code ou lien de configuration invalide." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const invite = invitationToken ? await findSceneInvitation(admin, invitationToken) : null;
  if (invitationToken && !invite) return json({ error: "Cette invitation a expiré ou a été retirée." }, 404);
  let clientEmail = invite?.email;
  if (!invite) {
    const { data: scene } = await admin.from("scenes").select("client_email")
      .eq("share_token", sceneToken).maybeSingle();
    if (!scene?.client_email) return json({ error: "Scène introuvable." }, 404);
    clientEmail = firstValidEmail(scene.client_email);
  }
  if (!clientEmail) return json({ error: "Aucune adresse email valide n'est associée à cette scène." }, 400);

  const auth = createClient(supabaseUrl, anonKey);
  const { data, error } = await auth.auth.verifyOtp({
    email: clientEmail,
    token: String(code),
    type: "email",
  });

  if (error || !data.session) {
    return json({ error: "Code incorrect ou expiré." }, 401);
  }

  if (invite) {
    const user = data.session.user;
    if (!user.email_confirmed_at || sceneEmail(user.email) !== invite.email || (invite.user_id && invite.user_id !== user.id)) {
      return json({ error: "Accès refusé." }, 403);
    }
    if (!invite.accepted_at) {
      const now = new Date().toISOString();
      const { data: accepted, error: acceptError } = await admin.from("scene_collaborators")
        .update({ user_id: user.id, accepted_at: now }).eq("id", invite.id).eq("email", invite.email)
        .is("accepted_at", null).gt("expires_at", now).select("id").maybeSingle();
      if (acceptError || !accepted) return json({ error: "Cette invitation a expiré ou a été retirée." }, 404);
    }
  }

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    ...(invite ? { scene_token: invite.scenes.share_token } : {}),
  });
});

function firstValidEmail(value: string) {
  return String(value || "")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
    ?.toLowerCase() || "";
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
