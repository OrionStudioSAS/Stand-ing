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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const { scene_token: sceneToken } = await req.json().catch(() => ({}));

  if (!sceneToken || typeof sceneToken !== "string") {
    return json({ error: "Lien de configuration invalide." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select("id, client_email")
    .eq("share_token", sceneToken)
    .maybeSingle();

  if (sceneError || !scene?.client_email) {
    return json({ error: "Aucune adresse email n'est associée à cette scène." }, 404);
  }

  const clientEmail = scene.client_email.trim().toLowerCase();
  const authUser = await ensureConfirmedAuthUser(admin, clientEmail);
  if (!authUser) return json({ error: "Impossible de préparer l'accès email pour cette scène." }, 500);

  const { data: previous } = await admin
    .from("scene_access_requests")
    .select("requested_at")
    .eq("scene_id", scene.id)
    .maybeSingle();

  const requestedAt = previous?.requested_at ? new Date(previous.requested_at).getTime() : 0;
  const retryAfter = Math.ceil((requestedAt + 60000 - Date.now()) / 1000);
  if (retryAfter > 0) {
    return json({
      error: `Un code vient déjà d'être envoyé. Réessaie dans ${retryAfter}s.`,
      retry_after: retryAfter,
    }, 429);
  }

  const auth = createClient(supabaseUrl, anonKey);
  const { error: otpError } = await auth.auth.signInWithOtp({
    email: clientEmail,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: Deno.env.get("PUBLIC_APP_URL") || "https://stand-ing.vercel.app/",
    },
  });

  if (otpError) return json({ error: otpError.message }, 400);

  await admin.from("scene_access_requests").upsert({
    scene_id: scene.id,
    requested_at: new Date().toISOString(),
  });

  return json({ masked_email: maskEmail(clientEmail) });
});

async function ensureConfirmedAuthUser(admin: any, email: string) {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    if (!existing.email_confirmed_at) {
      const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
      });
      if (error) throw error;
      await linkExhibitorProfile(admin, email, data.user?.id || existing.id);
      return data.user || existing;
    }
    await linkExhibitorProfile(admin, email, existing.id);
    return existing;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { role: "exposant", source: "scene_access" },
  });
  if (error) throw error;
  await linkExhibitorProfile(admin, email, data.user.id);
  return data.user;
}

async function findAuthUserByEmail(admin: any, email: string) {
  let page = 1;
  const perPage = 1000;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate: any) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

async function linkExhibitorProfile(admin: any, email: string, userId: string) {
  await admin
    .from("user_profiles")
    .update({ auth_user_id: userId, updated_at: new Date().toISOString() })
    .eq("email", email)
    .is("auth_user_id", null);
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
