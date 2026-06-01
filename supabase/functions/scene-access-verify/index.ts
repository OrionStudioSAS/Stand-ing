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
  const { scene_token: sceneToken, code } = await req.json().catch(() => ({}));

  if (!sceneToken || typeof sceneToken !== "string" || !/^\d{6,10}$/.test(String(code || ""))) {
    return json({ error: "Code ou lien de configuration invalide." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select("client_email")
    .eq("share_token", sceneToken)
    .maybeSingle();

  if (sceneError || !scene?.client_email) {
    return json({ error: "Scène introuvable." }, 404);
  }

  const auth = createClient(supabaseUrl, anonKey);
  const { data, error } = await auth.auth.verifyOtp({
    email: scene.client_email,
    token: String(code),
    type: "email",
  });

  if (error || !data.session) {
    return json({ error: "Code incorrect ou expiré." }, 401);
  }

  return json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
