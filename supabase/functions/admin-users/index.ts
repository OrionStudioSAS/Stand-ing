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
    .select("user_id, full_name, email, role_label, is_active")
    .eq("user_id", currentUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (adminError) return json({ error: adminError.message }, 500);
  if (!adminUser) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action) || "list";

  try {
    if (action === "audit") {
      const offset = Number(body.offset ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return json({ error: "Offset invalide." }, 400);
      const { data, error } = await admin.from("admin_audit_events")
        .select("id, actor_user_id, actor_name, action, detail, salon, target_id, created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + 100);
      if (error) throw error;
      return json({ events: (data || []).slice(0, 100), hasMore: (data || []).length > 100 });
    }

    const canManage = isSuperAdmin(adminUser.role_label);
    if (["create", "update", "delete"].includes(action) && !canManage) return json({ error: "Accès réservé aux super admins." }, 403);

    if (action === "create") {
      const email = clean(body.email).toLowerCase();
      const fullName = clean(body.fullName);
      const organization = clean(body.organization);
      const role = allowedRole(body.role);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !role) return json({ error: "Nom, e-mail et rôle valides requis." }, 400);
      const existing = (await listAuthUsers(admin)).find((user: any) => clean(user.email).toLowerCase() === email);
      let userId = existing?.id;
      let invited = false;
      if (!userId) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: `${(Deno.env.get("PUBLIC_APP_URL") || "https://configurateur3d.stand-ing.com").replace(/\/$/, "")}/admin`,
        });
        if (error) return json({ error: error.message }, 400);
        userId = data.user?.id;
        invited = true;
      }
      if (!userId) return json({ error: "Création du compte impossible." }, 500);
      const { data: existingAdmin, error: existingError } = await admin.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
      if (existingError) throw existingError;
      if (existingAdmin) return json({ error: "Ce compte administrateur existe déjà." }, 409);
      const { error: saveError } = await admin.from("admin_users").insert({ user_id: userId, email, full_name: fullName, role_label: role, is_active: true, profile_metadata: { organization } });
      if (saveError) return json({ error: saveError.message }, 500);
      const auditWarning = await writeAudit(admin, currentUserId, adminUser, "Utilisateur créé", `${fullName} — ${role}`, userId);
      return json({ created: true, invited, userId, auditWarning });
    }

    if (action === "update") {
      const userId = clean(body.userId);
      const fullName = clean(body.fullName);
      const organization = clean(body.organization);
      const role = allowedRole(body.role);
      const isActive = body.isActive === true;
      if (!userId || !fullName || !role || typeof body.isActive !== "boolean") return json({ error: "Nom, rôle et accès requis." }, 400);
      const { data: target, error: targetError } = await admin.from("admin_users").select("user_id, full_name, email, role_label, is_active, profile_metadata").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Compte admin introuvable." }, 404);
      if (userId === currentUserId && (!isActive || !isSuperAdmin(role))) return json({ error: "Impossible de retirer tes propres droits super admin." }, 400);
      if (isSuperAdmin(target.role_label) && (!isActive || !isSuperAdmin(role)) && !(await hasAnotherSuperAdmin(admin, userId))) return json({ error: "Conserve au moins un super admin actif." }, 400);
      const { error } = await admin.from("admin_users").update({ full_name: fullName, role_label: role, is_active: isActive, profile_metadata: { ...(target.profile_metadata || {}), organization } }).eq("user_id", userId);
      if (error) throw error;
      const actionName = target.is_active !== isActive ? (isActive ? "Accès activé" : "Accès désactivé") : "Utilisateur modifié";
      const auditWarning = await writeAudit(admin, currentUserId, adminUser, actionName, `${fullName} — ${role}`, userId);
      return json({ updated: true, userId, auditWarning });
    }

    if (action === "delete") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      if (userId === currentUserId) return json({ error: "Impossible de supprimer ton propre compte admin." }, 400);
      const { data: target, error: targetError } = await admin.from("admin_users").select("full_name, email, role_label").eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Compte admin introuvable." }, 404);
      if (target && isSuperAdmin(target.role_label) && !(await hasAnotherSuperAdmin(admin, userId))) return json({ error: "Conserve au moins un super admin actif." }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 500);
      const auditWarning = await writeAudit(admin, currentUserId, adminUser, "Utilisateur supprimé", target.full_name || target.email || userId, userId);
      return json({ deleted: true, userId, auditWarning });
    }

    if (action !== "list") return json({ error: "Action inconnue." }, 400);
    const rows = await listUsers(admin, currentUserId, canManage);
    return json({ users: rows });
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }
});

async function listUsers(admin: any, currentUserId: string, canManage: boolean) {
  const [authUsers, adminUsers, clients] = await Promise.all([
    listAuthUsers(admin),
    queryAll(admin.from("admin_users").select("user_id, full_name, role_label, avatar_url, profile_metadata, is_active, created_at")),
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
      organization: adminProfile?.profile_metadata?.organization || "",
      is_active: adminProfile ? adminProfile.is_active !== false : true,
      last_sign_in_at: user.last_sign_in_at || null,
      created_at: user.created_at || linkedClients[0]?.created_at || null,
      scenes_count: linkedClients.reduce((sum: number, client: any) => sum + (client.scenes?.length || 0), 0),
      salons: linkedSalons,
      can_delete: user.id !== currentUserId,
      can_manage: canManage,
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
      organization: "",
      is_active: false,
      last_sign_in_at: null,
      created_at: client.created_at || null,
      scenes_count: client.scenes?.length || 0,
      client_ids: [client.id].filter(Boolean),
      salons: unique((client.scenes || []).map((scene: any) => clean(scene.event_name) || clean(scene.salon)).filter(Boolean)),
      can_delete: true,
      can_manage: canManage,
    });
  });

  return rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

function isSuperAdmin(role: unknown) {
  return ["admin", "super admin", "super administrateur"].includes(clean(role).toLowerCase());
}

function allowedRole(role: unknown) {
  const value = clean(role);
  return ["Super admin", "Prestataire", "Dessinateur"].includes(value) ? value : "";
}

async function hasAnotherSuperAdmin(admin: any, excludedUserId: string) {
  const { data, error } = await admin.from("admin_users").select("user_id, role_label").eq("is_active", true).neq("user_id", excludedUserId);
  if (error) throw error;
  return (data || []).some((row: any) => isSuperAdmin(row.role_label));
}

async function writeAudit(admin: any, actorId: string, actor: any, action: string, detail: string, targetId: string) {
  const { error } = await admin.from("admin_audit_events").insert({
    actor_user_id: actorId, actor_name: actor.full_name || actor.email || "Admin",
    action, detail, target_id: targetId,
  });
  if (error) {
    console.error("Admin audit write failed", error.message);
    return "Action effectuée, mais journalisation indisponible.";
  }
  return null;
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
