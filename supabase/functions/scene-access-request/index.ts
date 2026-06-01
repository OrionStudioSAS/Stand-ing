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
    email: scene.client_email,
    options: { shouldCreateUser: true },
  });

  if (otpError) return json({ error: otpError.message }, 400);

  await admin.from("scene_access_requests").upsert({
    scene_id: scene.id,
    requested_at: new Date().toISOString(),
  });

  return json({ masked_email: maskEmail(scene.client_email) });
});

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
