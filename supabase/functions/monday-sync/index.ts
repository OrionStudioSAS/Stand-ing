import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const mondayApiUrl = "https://api.monday.com/v2";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mondayToken = Deno.env.get("MONDAY_API_TOKEN");
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://stand-ing.vercel.app/";

  if (!mondayToken) {
    return json({ error: "Missing MONDAY_API_TOKEN" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: sources, error } = await supabase
    .from("monday_sources")
    .select("*")
    .eq("is_active", true);

  if (error) return json({ error: error.message }, 500);

  let processed = 0;
  for (const source of sources ?? []) {
    const items = await fetchMondayItems(mondayToken, source.board_id, source.group_id);
    for (const item of items) {
      const createValue = readColumn(item, source.create_column_id);
      const triggerValues = source.create_trigger_values ?? ["OK", "OUI"];
      if (!triggerValues.some((value: string) => normalizeText(createValue) === normalizeText(value))) continue;

      const scene = mapMondayItemToScene(item, source);
      const { data: savedScene, error: saveError } = await supabase
        .from("scenes")
        .upsert(scene, { onConflict: "monday_item_id" })
        .select("share_token")
        .single();

      if (saveError) throw saveError;

      const shareUrl = publicAppUrl && savedScene?.share_token
        ? `${publicAppUrl.replace(/\/$/, "")}?scene=${savedScene.share_token}`
        : "";

      if (source.status_column_id) {
        await updateMondayColumnValue(mondayToken, source.board_id, item.id, source.status_column_id, {
          label: source.created_status_label ?? "ENVOYE PAR MAIL",
        });
      }
      if (source.link_column_id && shareUrl) {
        await updateMondayColumnValue(mondayToken, source.board_id, item.id, source.link_column_id, {
          url: shareUrl,
          text: "Configurer mon stand",
        });
      }
      processed += 1;
    }
  }

  await supabase.from("monday_sync_runs").insert({ status: "success", processed_count: processed });
  return json({ processed });
});

async function fetchMondayItems(token: string, boardId: string, groupId?: string) {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 100) {
          items {
            id
            name
            group { id title }
            column_values { id text value }
          }
        }
      }
    }
  `;

  const response = await fetch(mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { boardId } }),
  });
  const payload = await response.json();
  const items = payload.data?.boards?.[0]?.items_page?.items ?? [];
  return groupId ? items.filter((item: any) => item.group?.id === groupId) : items;
}

function mapMondayItemToScene(item: any, source: any) {
  const mapping = source.mapping ?? {};
  const width = Number(readMappingValue(item, mapping.width_m)) || 4;
  const depth = Number(readMappingValue(item, mapping.depth_m)) || 3;
  const height = Number(readMappingValue(item, mapping.height_m)) || 2.5;
  const layout = normalizeLayout(readMappingValue(item, mapping.layout));
  const clientName = readMappingValue(item, mapping.client_name) || item.name;

  return {
    monday_item_id: item.id,
    monday_board_id: source.board_id,
    monday_group_id: source.group_id,
    salon: source.salon,
    offer: source.offer,
    status: "created",
    client_status: "not_started",
    client_name: clientName,
    client_email: readMappingValue(item, mapping.client_email),
    project_name: item.name,
    event_name: source.salon,
    width_m: width,
    depth_m: depth,
    height_m: height,
    layout,
    source_payload: item,
  };
}

function readColumn(item: any, columnId?: string) {
  if (!columnId) return "";
  return item.column_values?.find((column: any) => column.id === columnId)?.text ?? "";
}

function readMappingValue(item: any, mappingValue?: string | string[]) {
  if (!mappingValue) return "";
  if (Array.isArray(mappingValue)) {
    return mappingValue.map((columnId) => readColumn(item, columnId)).filter(Boolean).join(" ").trim();
  }
  return readColumn(item, mappingValue);
}

function normalizeLayout(value: string) {
  const normalized = normalizeText(value);
  if (normalized.includes("gauche")) return "left";
  if (normalized.includes("droite")) return "right";
  if (normalized.includes("arriere")) return "back";
  return "u";
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

async function updateMondayColumnValue(token: string, boardId: string, itemId: string, columnId: string, value: Record<string, unknown>) {
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;

  const response = await fetch(mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({
      query: mutation,
      variables: {
        boardId,
        itemId,
        columnId,
        value: JSON.stringify(value),
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors ?? payload));
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
