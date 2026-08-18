import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const mondayApiUrl = "https://api.monday.com/v2";
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

  const { data: adminUser, error: adminError } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (adminError) return json({ error: adminError.message }, 500);
  if (!adminUser) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const sceneId = clean(body.sceneId);
  const clientId = clean(body.clientId);
  if (!sceneId && !clientId) return json({ error: "Missing sceneId or clientId" }, 400);

  try {
    const targetScenes = await scenesToDelete(admin, { sceneId, clientId });
    if (!targetScenes.length) return json({ deletedScenes: 0, deletedClients: 0, mondayDeleted: 0, storageDeleted: 0 });

    const mondayToken = Deno.env.get("MONDAY_API_TOKEN") || "";
    const mondayResults: Array<{ sceneId: string; itemId: string; deleted: boolean; error?: string }> = [];
    if (mondayToken) {
      for (const scene of targetScenes) {
        const itemId = clean(scene.monday_item_id);
        if (!itemId) continue;
        try {
          await deleteMondayItem(mondayToken, itemId);
          mondayResults.push({ sceneId: scene.id, itemId, deleted: true });
        } catch (error) {
          mondayResults.push({ sceneId: scene.id, itemId, deleted: false, error: errorMessage(error) });
        }
      }
    }

    const storageDeleted = await deleteSceneStorage(admin, targetScenes);
    await markUploadedFilesInactive(admin, targetScenes.map((scene) => scene.id));

    const sceneIds = targetScenes.map((scene) => scene.id);
    const { error: fileError } = await admin.from("scene_files").delete().in("scene_id", sceneIds);
    if (fileError) return json({ error: fileError.message }, 500);

    const { error: itemError } = await admin.from("scene_items").delete().in("scene_id", sceneIds);
    if (itemError) return json({ error: itemError.message }, 500);

    const { error: accessError } = await admin.from("scene_access_requests").delete().in("scene_id", sceneIds);
    if (accessError) console.warn("scene_access_requests cleanup failed", accessError.message);

    const { error: sceneError } = await admin.from("scenes").delete().in("id", sceneIds);
    if (sceneError) return json({ error: sceneError.message }, 500);

    const clientIds = [...new Set(targetScenes.map((scene) => scene.client_id).filter(Boolean))];
    if (clientId) clientIds.push(clientId);
    const deletedClients = await deleteEmptyClients(admin, [...new Set(clientIds)], authData.user.id);

    return json({
      deletedScenes: targetScenes.length,
      deletedClients,
      mondayDeleted: mondayResults.filter((item) => item.deleted).length,
      mondayFailed: mondayResults.filter((item) => !item.deleted),
      storageDeleted,
    });
  } catch (error) {
    return json({ error: errorMessage(error) }, 500);
  }
});

async function scenesToDelete(admin: any, { sceneId, clientId }: { sceneId?: string; clientId?: string }) {
  let query = admin.from("scenes").select("id, share_token, client_id, monday_item_id, source_payload");
  query = sceneId ? query.eq("id", sceneId) : query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function deleteMondayItem(token: string, itemId: string) {
  const query = `mutation($itemId: ID!){ delete_item(item_id: $itemId){ id } }`;
  const response = await fetch(mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "api-version": "2025-04" },
    body: JSON.stringify({ query, variables: { itemId } }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) throw new Error(JSON.stringify(payload.errors ?? payload));
  return payload;
}

async function deleteSceneStorage(admin: any, scenes: any[]) {
  const bucket = admin.storage.from("object-assets");
  const explicitPaths = new Set<string>();
  const prefixes = new Set<string>();

  scenes.forEach((scene) => {
    [scene.id, scene.share_token].filter(Boolean).forEach((id) => prefixes.add(`scene-options/${slugify(id)}`));
    collectStoragePaths(scene.source_payload, explicitPaths);
  });

  const { data: files } = await admin.from("scene_files").select("storage_path").in("scene_id", scenes.map((scene) => scene.id));
  (files || []).forEach((file: any) => file.storage_path && explicitPaths.add(file.storage_path));

  let deleted = 0;
  for (const prefix of prefixes) {
    const paths = await listStoragePaths(bucket, prefix);
    deleted += await removeStoragePaths(bucket, paths);
  }
  deleted += await removeStoragePaths(bucket, [...explicitPaths].filter((path) => path && !path.includes("/object-assets/")));
  return deleted;
}

async function listStoragePaths(bucket: any, prefix: string) {
  const output: string[] = [];
  async function walk(path: string) {
    const { data, error } = await bucket.list(path, { limit: 1000 });
    if (error || !data) return;
    for (const entry of data) {
      const fullPath = `${path}/${entry.name}`.replace(/^\/+/, "");
      if (entry.id || entry.metadata) output.push(fullPath);
      else await walk(fullPath);
    }
  }
  await walk(prefix);
  return output;
}

async function removeStoragePaths(bucket: any, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  let deleted = 0;
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    const { error } = await bucket.remove(chunk);
    if (!error) deleted += chunk.length;
  }
  return deleted;
}

function collectStoragePaths(value: unknown, output: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    const match = value.match(/\/storage\/v1\/object\/public\/object-assets\/([^?#]+)/);
    if (match?.[1]) output.add(decodeURIComponent(match[1]));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStoragePaths(item, output));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (/storagePath$/i.test(key) && typeof nested === "string") output.add(nested);
      collectStoragePaths(nested, output);
    });
  }
}

async function markUploadedFilesInactive(admin: any, sceneIds: string[]) {
  const { error } = await admin
    .from("scene_uploaded_files")
    .update({ is_active: false })
    .in("scene_id", sceneIds);
  if (error) console.warn("scene_uploaded_files cleanup failed", error.message);
}

async function deleteEmptyClients(admin: any, clientIds: string[], currentUserId: string) {
  let deleted = 0;
  for (const clientId of clientIds) {
    const { count, error: countError } = await admin
      .from("scenes")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    if (countError || Number(count || 0) > 0) continue;

    const { data: client } = await admin
      .from("clients")
      .select("id, email")
      .eq("id", clientId)
      .maybeSingle();

    await deleteAuthUsersByEmail(admin, client?.email, currentUserId);
    const { error } = await admin.from("clients").delete().eq("id", clientId);
    if (!error) deleted += 1;
  }
  return deleted;
}

async function deleteAuthUsersByEmail(admin: any, email: string, currentUserId: string) {
  const normalizedEmail = clean(email).toLowerCase();
  if (!normalizedEmail) return 0;
  const users = await listAuthUsers(admin);
  let deleted = 0;
  for (const user of users) {
    if (clean(user.email).toLowerCase() !== normalizedEmail) continue;
    if (user.id === currentUserId) continue;
    const { data: adminRow } = await admin.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminRow) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (!error) deleted += 1;
  }
  return deleted;
}

async function listAuthUsers(admin: any) {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) break;
  }
  return users;
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function slugify(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scene";
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
