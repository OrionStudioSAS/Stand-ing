import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase env missing" }, 500);

  const admin = createClient(supabaseUrl, serviceKey);
  const accessToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ error: "Unauthorized" }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData?.user?.id) return json({ error: "Unauthorized" }, 401);

  const currentUserId = authData.user.id;
  const { data: adminUser, error: adminError } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", currentUserId)
    .maybeSingle();
  if (adminError) return json({ error: adminError.message }, 500);
  if (!adminUser) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action) || "list";

  try {
    if (action === "delete") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      if (userId === currentUserId) return json({ error: "Impossible de supprimer ton propre compte admin." }, 400);
      await admin.from("admin_users").delete().eq("user_id", userId);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 500);
      return json({ deleted: true, userId });
    }

    const rows = await listUsers(admin, currentUserId);
    return json({ users: rows });
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }
});

async function listUsers(admin: any, currentUserId: string) {
  const [authUsers, adminUsers, clients] = await Promise.all([
    listAuthUsers(admin),
    queryAll(admin.from("admin_users").select("user_id, full_name, role_label, avatar_url, created_at")),
    queryAll(admin.from("clients").select("id, display_name, company_name, email, created_at, updated_at, scenes(id, salon, event_name)")),
  ]);

  const adminByUserId = new Map(adminUsers.map((row: any) => [row.user_id, row]));
  const clientsByEmail = new Map<string, any[]>();
  clients.forEach((client: any) => {
    const email = clean(client.email).toLowerCase();
    if (!email) return;
    clientsByEmail.set(email, [...(clientsByEmail.get(email) || []), client]);
  });

  const rows: any[] = authUsers.map((user: any) => {
    const email = clean(user.email).toLowerCase();
    const linkedClients = clientsByEmail.get(email) || [];
    const adminProfile = adminByUserId.get(user.id) || null;
    const linkedSalons = unique(linkedClients.flatMap((client: any) => (client.scenes || []).map((scene: any) => clean(scene.event_name) || clean(scene.salon)).filter(Boolean)));
    return {
      id: `auth:${user.id}`,
      auth_user_id: user.id,
      client_id: linkedClients[0]?.id || null,
      client_ids: linkedClients.map((client: any) => client.id).filter(Boolean),
      email: user.email || linkedClients[0]?.email || "",
      display_name: adminProfile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || linkedClients[0]?.display_name || linkedClients[0]?.company_name || user.email || "Utilisateur",
      role: adminProfile ? (adminProfile.role_label || "Admin") : "Exposant",
      kind: adminProfile ? "admin" : "exposant",
      created_at: user.created_at || linkedClients[0]?.created_at || null,
      scenes_count: linkedClients.reduce((sum: number, client: any) => sum + (client.scenes?.length || 0), 0),
      salons: linkedSalons,
      can_delete: user.id !== currentUserId,
    };
  });

  const authEmails = new Set(authUsers.map((user: any) => clean(user.email).toLowerCase()).filter(Boolean));
  clients.forEach((client: any) => {
    const email = clean(client.email).toLowerCase();
    if (email && authEmails.has(email)) return;
    rows.push({
      id: `client:${client.id}`,
      auth_user_id: null,
      client_id: client.id,
      email: client.email || "",
      display_name: client.company_name || client.display_name || client.email || "Exposant",
      role: "Exposant",
      kind: "exposant",
      created_at: client.created_at || null,
      scenes_count: client.scenes?.length || 0,
      client_ids: [client.id].filter(Boolean),
      salons: unique((client.scenes || []).map((scene: any) => clean(scene.event_name) || clean(scene.salon)).filter(Boolean)),
      can_delete: true,
    });
  });

  return rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

async function listAuthUsers(admin: any) {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function queryAll(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Erreur inconnue");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
