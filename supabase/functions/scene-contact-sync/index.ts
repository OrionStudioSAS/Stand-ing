import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const mondayApiUrl = "https://api.monday.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mondayToken = Deno.env.get("MONDAY_API_TOKEN");
  if (!mondayToken) return json({ error: "Missing MONDAY_API_TOKEN" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const body = await req.json().catch(() => ({}));
  const sceneId = String(body.sceneId || "");
  const shareToken = String(body.shareToken || "");
  const contact = body.contactDetails || {};

  if (!sceneId && !shareToken) return json({ error: "Missing scene identifier" }, 400);

  let sceneQuery = supabase
    .from("scenes")
    .select("id, share_token, monday_item_id, monday_board_id, monday_group_id, salon, offer, client_id, exhibitor_user_id, source_payload")
    .limit(1);
  sceneQuery = sceneId ? sceneQuery.eq("id", sceneId) : sceneQuery.eq("share_token", shareToken);
  const { data: scenes, error: sceneError } = await sceneQuery;
  if (sceneError) return json({ error: sceneError.message }, 500);
  const scene = scenes?.[0];
  if (!scene) return json({ error: "Scene not found" }, 404);
  if (shareToken && scene.share_token !== shareToken) return json({ error: "Forbidden" }, 403);

  const { data: source } = await supabase
    .from("monday_sources")
    .select("*")
    .eq("board_id", scene.monday_board_id)
    .eq("is_active", true)
    .maybeSingle();

  const mapping = source?.mapping || {};
  const boardId = scene.monday_board_id || source?.board_id;
  const itemId = scene.monday_item_id;
  if (!boardId || !itemId) return json({ synced: false, reason: "Scene has no Monday link" });

  const updates: Array<Promise<unknown>> = [];
  const firstName = clean(contact.firstName);
  const lastName = clean(contact.lastName);
  const company = clean(contact.company);
  const email = clean(contact.email);
  const phone = clean(contact.phone);
  const role = clean(contact.role);
  const address = clean(contact.address);
  const zip = clean(contact.zip);
  const city = clean(contact.city);
  const country = clean(contact.country);

  if (company) updates.push(changeMondayItemName(mondayToken, boardId, itemId, company));
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.client_name, [firstName, lastName].filter(Boolean).join(" "), [firstName, lastName]);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.contact_name || mapping.contact, [firstName, lastName].filter(Boolean).join(" "), [firstName, lastName]);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.company_name, company);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.client_email, email);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.client_phone || mapping.phone, phone);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.role || mapping.function, role);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.address, address);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.zip || mapping.postal_code, zip);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.city, city);
  pushMappedValue(updates, mondayToken, boardId, itemId, mapping.country, country);

  const results = await Promise.allSettled(updates);
  const failedUpdates = results
    .filter((result) => result.status === "rejected")
    .map((result: PromiseRejectedResult) => String(result.reason?.message || result.reason || "Erreur Monday"));

  if (scene.client_id) {
    await supabase.from("clients").update({
      display_name: [firstName, lastName].filter(Boolean).join(" ") || company || null,
      company_name: company || null,
      email: email || null,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    }).eq("id", scene.client_id);
  }

  if (scene.exhibitor_user_id) {
    await supabase.from("user_profiles").update({
      full_name: [firstName, lastName].filter(Boolean).join(" ") || company || null,
      company_name: company || null,
      email: email || null,
      phone: phone || null,
      updated_at: new Date().toISOString(),
    }).eq("id", scene.exhibitor_user_id);
  }

  return json({ synced: true, updates: updates.length - failedUpdates.length, failed_updates: failedUpdates });
});

function pushMappedValue(updates: Array<Promise<unknown>>, token: string, boardId: string, itemId: string, mappingValue: string | string[] | undefined, value: string, splitValues?: string[]) {
  if (!mappingValue) return;
  if (Array.isArray(mappingValue)) {
    mappingValue.forEach((columnId, index) => {
      const part = splitValues?.[index] ?? value;
      if (columnId && part) updates.push(updateMondaySimpleColumnValue(token, boardId, itemId, columnId, part));
    });
    return;
  }
  if (value) updates.push(updateMondaySimpleColumnValue(token, boardId, itemId, mappingValue, value));
}

async function changeMondayItemName(token: string, boardId: string, itemId: string, name: string) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $name: String!) {
      change_item_name(board_id: $boardId, item_id: $itemId, item_name: $name) { id }
    }
  `;
  await mondayRequest(token, mutation, { boardId, itemId, name });
}

async function updateMondaySimpleColumnValue(token: string, boardId: string, itemId: string, columnId: string, value: string) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await mondayRequest(token, mutation, { boardId, itemId, columnId, value });
}

async function mondayRequest(token: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch(mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) throw new Error(JSON.stringify(payload.errors ?? payload));
  return payload;
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
