import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const mondayApiUrl = "https://api.monday.com/v2";
const wallThickness = 0.06;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mondayToken = Deno.env.get("MONDAY_API_TOKEN");
  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") || "https://stand-ing.vercel.app/";

  if (!mondayToken) {
    return json({ error: "Missing MONDAY_API_TOKEN" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const accessToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const { data: adminUser } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (!adminUser) return json({ error: "Admin access required" }, 403);

  const { data: sources, error } = await supabase
    .from("monday_sources")
    .select("*")
    .eq("is_active", true);

  if (error) return json({ error: error.message }, 500);

  let processed = 0;
  let clients = 0;
  let exhibitors = 0;
  let baseItemsApplied = 0;
  let constraintsUpdated = 0;
  const warnings: string[] = [];

  for (const source of sources ?? []) {
    const { columns: mondayColumns, warning: columnWarning } = await fetchMondayBoardColumnsSafe(mondayToken, source.board_id);
    if (columnWarning) warnings.push(columnWarning);
    if (String(source.board_id) === "18395911999" && mondayColumns.length) {
      warnings.push(...mondayConstraintColumnMessages(source.board_id, mondayColumns));
    }
    const resolvedSource = withResolvedConstraintColumns(source, mondayColumns);
    const context = await ensureSourceContext(supabase, resolvedSource);
    const items = await fetchMondayItems(mondayToken, resolvedSource.board_id, resolvedSource.group_id);

    for (const item of items) {
      const { data: existingScene, error: existingSceneError } = await supabase
        .from("scenes")
        .select("id, source_payload, width_m, depth_m")
        .eq("monday_item_id", item.id)
        .maybeSingle();
      if (existingSceneError) throw existingSceneError;
      if (existingScene) {
        const existingWidth = Number(existingScene.width_m) || Number(readMappingValue(item, resolvedSource.mapping?.width_m)) || 4;
        const existingDepth = Number(existingScene.depth_m) || Number(readMappingValue(item, resolvedSource.mapping?.depth_m)) || 3;
        const constraint = mondayConstraintForItem(item, resolvedSource, existingWidth, existingDepth);
        if (constraintColumnsConfigured(resolvedSource) || constraint) {
          const { error: updateConstraintError } = await supabase
            .from("scenes")
            .update({
              source_payload: {
                ...(existingScene.source_payload || {}),
                constraint,
              },
            })
            .eq("id", existingScene.id);
          if (updateConstraintError) throw updateConstraintError;
          constraintsUpdated += 1;
        }
        continue;
      }

      const createValue = readColumn(item, resolvedSource.create_column_id);
      const triggerValues = resolvedSource.create_trigger_values ?? ["OK", "OUI"];
      if (!triggerValues.some((value: string) => normalizeText(createValue) === normalizeText(value))) continue;

      const userProfile = mapMondayItemToUserProfile(item, resolvedSource);
      const { data: savedProfile, error: profileError } = await supabase
        .from("user_profiles")
        .upsert(userProfile, { onConflict: "profile_key" })
        .select("id")
        .single();
      if (profileError) throw profileError;

      const client = mapMondayItemToClient(item, resolvedSource, savedProfile?.id);
      const { data: savedClient, error: clientError } = await supabase
        .from("clients")
        .upsert(client, { onConflict: "client_key" })
        .select("id")
        .single();
      if (clientError) throw clientError;

      if (context.salonId && savedProfile?.id && savedClient?.id) {
        const { error: membershipError } = await supabase
          .from("exhibitor_salon_memberships")
          .upsert({
            user_profile_id: savedProfile.id,
            client_id: savedClient.id,
            salon_id: context.salonId,
            role: "exposant",
            metadata: {
              monday_item_id: item.id,
              monday_board_id: source.board_id,
              monday_group_id: source.group_id,
              offer: source.offer,
            },
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_profile_id,client_id,salon_id" });
        if (membershipError) throw membershipError;
      }

      const sceneDraft = mapMondayItemToScene(item, resolvedSource, savedClient?.id, savedProfile?.id, context);
      const preset = await findActivePreset(supabase, context.offerId, context.salonId, sceneDraft.layout);
      const baseItems = await fetchOfferBaseItems(supabase, context.offerId);
      const defaultOptions = presetDefaultOptions(preset);
      const scene = {
        ...sceneDraft,
        base_preset_id: preset?.id || null,
        source_payload: {
          ...(sceneDraft.source_payload || {}),
          options: {
            ...((sceneDraft.source_payload || {}).options || {}),
            ...defaultOptions,
          },
          baseItems,
          reserveRules: presetReserveRules(preset),
          partitionHeadRules: presetPartitionHeadRules(preset),
          pricing: {
            ...((sceneDraft.source_payload || {}).pricing || {}),
            baseItems,
            reserveRules: presetReserveRules(preset),
            partitionHeadRules: presetPartitionHeadRules(preset),
          },
        },
      };
      const { data: savedScene, error: saveError } = await supabase
        .from("scenes")
        .upsert(scene, { onConflict: "monday_item_id" })
        .select("id, share_token")
        .single();

      if (saveError) throw saveError;

      if (savedScene?.id && preset?.stand_preset_items?.length) {
        const inserted = await applyPresetItems(supabase, savedScene.id, preset, scene);
        baseItemsApplied += inserted;
      }

      const shareUrl = publicAppUrl && savedScene?.share_token
        ? `${publicAppUrl.replace(/\/$/, "")}?scene=${savedScene.share_token}`
        : "";

      if (resolvedSource.status_column_id && resolvedSource.status_column_id !== resolvedSource.create_column_id) {
        await updateMondayColumnValue(mondayToken, resolvedSource.board_id, item.id, resolvedSource.status_column_id, {
          label: resolvedSource.created_status_label ?? "ENVOYE PAR MAIL",
        });
      }
      if (resolvedSource.link_column_id && resolvedSource.link_column_id !== resolvedSource.create_column_id && shareUrl) {
        await updateMondayColumnValue(mondayToken, resolvedSource.board_id, item.id, resolvedSource.link_column_id, {
          url: shareUrl,
          text: "Configurer mon stand",
        });
      }

      processed += 1;
      clients += 1;
      exhibitors += 1;
    }
  }

  await supabase.from("monday_sync_runs").insert({ status: "success", processed_count: processed });
  return json({ processed, created: processed, clients, exhibitors, base_items_applied: baseItemsApplied, constraints_updated: constraintsUpdated, warnings });
});

function withResolvedConstraintColumns(source: any, columns: Array<{ id: string; title: string }>) {
  const mapping = source.mapping ?? {};
  const constraintColumnId = mapping.constraint || mapping.contrainte || findConstraintSizeColumnId(columns);
  const constraintLocationColumnId = mapping.constraint_location
    || mapping.emplacement_contrainte
    || findConstraintLocationColumnId(columns);

  return {
    ...source,
    mapping: {
      ...mapping,
      ...(constraintColumnId ? { constraint: constraintColumnId } : {}),
      ...(constraintLocationColumnId ? { constraint_location: constraintLocationColumnId } : {}),
    },
  };
}

function mondayConstraintColumnMessages(boardId: string, columns: Array<{ id: string; title: string }>) {
  const messages: string[] = [];
  const sizeColumnId = findConstraintSizeColumnId(columns);
  const locationColumnId = findConstraintLocationColumnId(columns);

  if (sizeColumnId) messages.push(`ID colonne Contrainte détecté sur le board ${boardId}: ${sizeColumnId}`);
  if (locationColumnId) messages.push(`ID colonne Emplacement contrainte détecté sur le board ${boardId}: ${locationColumnId}`);

  if (!sizeColumnId || !locationColumnId) {
    messages.push(`Colonnes disponibles sur le board ${boardId}: ${formatMondayColumnList(columns)}`);
  }

  if (!sizeColumnId) messages.push(`Colonne Monday manquante sur le board ${boardId}: Contrainte`);
  if (!locationColumnId) messages.push(`Colonne Monday manquante sur le board ${boardId}: Emplacement contrainte`);
  return messages;
}

function formatMondayColumnList(columns: Array<{ id: string; title: string }>) {
  return columns.map((column) => `${column.title || '(sans titre)'} [${column.id}]`).join(' | ');
}

function findConstraintSizeColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "contrainte")
    || findMondayColumnId(columns, (value) => value.includes("contrainte") && !value.includes("emplacement") && !value.includes("empacement"));
}

function findConstraintLocationColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value.includes("contrainte") && (value.includes("emplacement") || value.includes("empacement")));
}

function findMondayColumnId(columns: Array<{ id: string; title: string }>, predicate: (value: string) => boolean) {
  return columns.find((column) => [column.title, column.id].some((candidate) => predicate(normalizeColumnLookup(candidate))))?.id || "";
}

function constraintColumnsConfigured(source: any) {
  const mapping = source.mapping ?? {};
  return Boolean((mapping.constraint || mapping.contrainte) && (mapping.constraint_location || mapping.emplacement_contrainte));
}

async function fetchMondayBoardColumnsSafe(token: string, boardId: string) {
  try {
    return { columns: await fetchMondayBoardColumns(token, boardId), warning: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      columns: [],
      warning: `Impossible de récupérer les IDs de colonnes Monday du board ${boardId}: ${message}`,
    };
  }
}

async function fetchMondayBoardColumns(token: string, boardId: string) {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        columns { id title }
      }
    }
  `;

  const response = await fetch(mondayApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { boardId } }),
  });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((entry: any) => entry.message).join(", "));
  return (payload.data?.boards?.[0]?.columns || [])
    .map((column: any) => ({ id: String(column.id || ""), title: String(column.title || "") }))
    .filter((column: any) => column.id);
}

async function ensureSourceContext(supabase: any, source: any) {
  if (source.salon_id) {
    return { salonId: source.salon_id, offerId: source.offer_id || null };
  }

  const salonSlug = slugify(`${source.salon || "salon"}-2026`);
  const { data: salon, error: salonError } = await supabase
    .from("salons")
    .upsert({
      slug: salonSlug,
      name: source.salon || "Salon",
      year: 2026,
      status: "draft",
      metadata: { source: "monday_sync_fallback" },
      updated_at: new Date().toISOString(),
    }, { onConflict: "slug" })
    .select("id")
    .single();
  if (salonError) throw salonError;

  const offerSlug = slugify(source.offer || "standard");
  const { data: offer, error: offerError } = await supabase
    .from("salon_offers")
    .upsert({
      salon_id: salon.id,
      slug: offerSlug,
      name: source.offer || "Standard",
      metadata: { source: "monday_sync_fallback" },
      updated_at: new Date().toISOString(),
    }, { onConflict: "salon_id,slug" })
    .select("id")
    .single();
  if (offerError) throw offerError;

  await supabase.from("monday_sources").update({ salon_id: salon.id, offer_id: offer.id }).eq("id", source.id);
  return { salonId: salon.id, offerId: offer.id };
}

async function fetchMondayItems(token: string, boardId: string, groupId?: string) {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 100) {
          items {
            id
            name
            group { id title }
            column_values { id text value column { title } }
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

function mapMondayItemToUserProfile(item: any, source: any) {
  const mapping = source.mapping ?? {};
  const clientEmail = readMappingValue(item, mapping.client_email);
  const clientName = readMappingValue(item, mapping.client_name) || item.name;
  const contactName = readMappingValue(item, mapping.contact_name) || readMappingValue(item, mapping.contact);
  const companyName = readMappingValue(item, mapping.company_name) || clientName;
  const phone = readMappingValue(item, mapping.client_phone) || readMappingValue(item, mapping.phone);

  return {
    profile_key: clientKey(clientEmail, companyName || contactName || item.name),
    email: normalizeEmail(clientEmail),
    role: "exposant",
    full_name: contactName || clientName || item.name,
    company_name: companyName || null,
    phone: phone || null,
    metadata: {
      monday_item_id: item.id,
      monday_board_id: source.board_id,
      monday_group_id: source.group_id,
      salon: source.salon,
      offer: source.offer,
    },
    updated_at: new Date().toISOString(),
  };
}

function mapMondayItemToClient(item: any, source: any, userProfileId?: string) {
  const mapping = source.mapping ?? {};
  const clientEmail = readMappingValue(item, mapping.client_email);
  const clientName = readMappingValue(item, mapping.client_name) || item.name;
  const contactName = readMappingValue(item, mapping.contact_name) || readMappingValue(item, mapping.contact);
  const companyName = readMappingValue(item, mapping.company_name) || clientName;
  const phone = readMappingValue(item, mapping.client_phone) || readMappingValue(item, mapping.phone);
  const commercialName = readMappingValue(item, mapping.commercial_name) || readMappingValue(item, mapping.commercial);

  return {
    client_key: clientKey(clientEmail, companyName || contactName || item.name),
    user_profile_id: userProfileId || null,
    display_name: contactName || companyName || clientName || item.name,
    company_name: companyName || null,
    email: normalizeEmail(clientEmail),
    phone: phone || null,
    commercial_name: commercialName || null,
    metadata: {
      monday_item_id: item.id,
      monday_board_id: source.board_id,
      monday_group_id: source.group_id,
      salon: source.salon,
      offer: source.offer,
    },
    updated_at: new Date().toISOString(),
  };
}

function mapMondayItemToScene(item: any, source: any, clientId: string | undefined, userProfileId: string | undefined, context: any) {
  const mapping = source.mapping ?? {};
  const { width, depth } = mondaySceneDimensions(item, source);
  const layout = normalizeLayout(readMappingValue(item, mapping.layout));
  const clientName = readMappingValue(item, mapping.client_name) || item.name;
  const standNumber = readMappingValue(item, mapping.stand_number) || readColumn(item, "n_");
  const aisleNumber = readMappingValue(item, mapping.aisle_number || mapping.allee) || readColumnAny(item, ["text5", "allée", "allee"]);
  const sector = readMappingValue(item, mapping.sector || mapping.secteur) || readColumnAny(item, ["dup__of_secteur1", "secteur"]);
  const constraint = mondayConstraintForItem(item, source, width, depth);

  return {
    monday_item_id: item.id,
    monday_board_id: source.board_id,
    monday_group_id: source.group_id,
    salon: source.salon,
    offer: source.offer,
    salon_id: context.salonId || null,
    offer_id: context.offerId || null,
    exhibitor_user_id: userProfileId || null,
    base_preset_id: null,
    status: "created",
    client_status: "not_started",
    client_name: clientName,
    client_email: readMappingValue(item, mapping.client_email),
    client_id: clientId || null,
    project_name: item.name,
    event_name: source.salon,
    width_m: width,
    depth_m: depth,
    height_m: 2.5,
    layout,
    source_payload: { ...item, stand_number: standNumber, aisle_number: aisleNumber, sector, constraint },
  };
}

function mondaySceneDimensions(item: any, source: any) {
  const mapping = source.mapping ?? {};
  return {
    width: Number(readMappingValue(item, mapping.width_m)) || 4,
    depth: Number(readMappingValue(item, mapping.depth_m)) || 3,
  };
}

function mondayConstraintForItem(item: any, source: any, width = 0, depth = 0) {
  const mapping = source.mapping ?? {};
  return parseSceneConstraint(
    readMappingValue(item, mapping.constraint || mapping.contrainte) || readColumnAny(item, ["contrainte"]),
    readMappingValue(item, mapping.constraint_location || mapping.emplacement_contrainte) || readColumnAny(item, ["emplacement contrainte", "emplacement_contrainte", "empacement contrainte"]),
    width,
    depth,
  );
}

function parseSceneConstraint(sizeValue = "", locationValue = "", width = 0, depth = 0) {
  const sizeParts = parseNumberParts(sizeValue);
  const locationParts = parseNumberParts(locationValue);
  if (sizeParts.length < 2 || locationParts.length < 2) return null;

  const sizeX = sizeParts[0] / 100;
  const sizeZ = sizeParts[1] / 100;
  const fromLeft = locationParts[0];
  const fromBack = locationParts[1];
  if (![sizeX, sizeZ, fromLeft, fromBack].every((value) => Number.isFinite(value) && value >= 0)) return null;

  return {
    rawSize: String(sizeValue || "").trim(),
    rawLocation: String(locationValue || "").trim(),
    width: Math.max(0.01, sizeX),
    depth: Math.max(0.01, sizeZ),
    height: 5,
    fromLeft,
    fromBack,
    x: clampNumber(-Number(width || 0) / 2 + fromLeft, -Number(width || 0) / 2, Number(width || 0) / 2),
    z: clampNumber(-Number(depth || 0) / 2 + fromBack, -Number(depth || 0) / 2, Number(depth || 0) / 2),
  };
}

function parseNumberParts(value = "") {
  return String(value || "")
    .replace(/,/g, ".")
    .match(/\d+(?:\.\d+)?/g)
    ?.map((part) => Number(part))
    .filter((part) => Number.isFinite(part)) || [];
}

async function findActivePreset(supabase: any, offerId?: string, salonId?: string, layout = "u") {
  if (offerId) {
    const exact = await findPresetByLayout(supabase, { offerId, layout });
    if (exact) return exact;

    const fallback = await findPresetByLayout(supabase, { offerId, layout: "u" });
    if (fallback) return fallback;

    const { data, error } = await supabase
      .from("stand_presets")
      .select("*, stand_preset_items(*)")
      .eq("offer_id", offerId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (!salonId) return null;
  const exactSalonPreset = await findPresetByLayout(supabase, { salonId, layout, offerIsNull: true });
  if (exactSalonPreset) return exactSalonPreset;

  const { data, error } = await supabase
    .from("stand_presets")
    .select("*, stand_preset_items(*)")
    .eq("salon_id", salonId)
    .is("offer_id", null)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchOfferBaseItems(supabase: any, offerId?: string) {
  if (!offerId) return [];
  const { data, error } = await supabase
    .from("salon_offers")
    .select("metadata")
    .eq("id", offerId)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.metadata?.baseItems) ? data.metadata.baseItems : [];
}

function presetReserveRules(preset: any) {
  return preset?.base_config?.reserveRules || preset?.base_config?.options?.reserveRules || {};
}

function presetPartitionHeadRules(preset: any) {
  return preset?.base_config?.partitionHeadRules || preset?.base_config?.options?.partitionHeadRules || {};
}

function presetAutoSpotsRule(preset: any) {
  return preset?.base_config?.autoSpotsRule || preset?.base_config?.options?.autoSpotsRule || null;
}

function presetDefaultOptions(preset: any) {
  const defaults = preset?.base_config?.defaultColorOptions || preset?.base_config?.options?.defaultColorOptions || {};
  return {
    ...defaults,
    defaultColorOptions: defaults,
    ...(presetAutoSpotsRule(preset) ? { autoSpotsRule: presetAutoSpotsRule(preset) } : {}),
  };
}

async function findPresetByLayout(supabase: any, params: { offerId?: string; salonId?: string; layout: string; offerIsNull?: boolean }) {
  let query = supabase
    .from("stand_presets")
    .select("*, stand_preset_items(*)")
    .eq("is_active", true)
    .eq("layout", params.layout)
    .order("created_at", { ascending: false })
    .limit(1);

  if (params.offerId) query = query.eq("offer_id", params.offerId);
  if (params.salonId) query = query.eq("salon_id", params.salonId);
  if (params.offerIsNull) query = query.is("offer_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function applyPresetItems(supabase: any, sceneId: string, preset: any, scene: any) {
  const items = preset.stand_preset_items ?? [];
  if (!items.length) return 0;

  const scaledItems = items.map((item: any) => scalePresetItemToScene(item, preset, scene));
  const { error } = await supabase.from("scene_items").insert(scaledItems.map((item: any) => ({
    scene_id: sceneId,
    item_uid: item.item_uid,
    type: item.type,
    label: item.label,
    x: item.x,
    y: item.y,
    z: item.z,
    rotation: item.rotation,
    wall: item.wall,
    config: {
      ...(item.config || {}),
      x: item.x,
      y: item.y,
      z: item.z,
      rotation: item.rotation,
      wall: item.wall,
      included: true,
      priceMode: "included",
      basePresetId: preset.id,
      presetAnchor: item.anchorMeta || null,
      presetReferenceSize: {
        width: Number(preset.width_m || scene.width_m),
        depth: Number(preset.depth_m || scene.depth_m),
      },
    },
  })));
  if (error) throw error;

  await supabase
    .from("scenes")
    .update({ base_items_applied_at: new Date().toISOString() })
    .eq("id", sceneId);

  return items.length;
}

function scalePresetItemToScene(item: any, preset: any, scene: any) {
  const presetWidth = Number(preset.width_m || scene.width_m || 1);
  const presetDepth = Number(preset.depth_m || scene.depth_m || 1);
  const sceneWidth = Number(scene.width_m || presetWidth || 1);
  const sceneDepth = Number(scene.depth_m || presetDepth || 1);
  const widthRatio = presetWidth ? sceneWidth / presetWidth : 1;
  const depthRatio = presetDepth ? sceneDepth / presetDepth : 1;
  const wall = item.wall || item.config?.wall || null;

  let x = Number(item.x || 0);
  let z = Number(item.z || 0);
  let anchorMeta: any = null;

  if (isPresetWallItem(item)) {
    const itemHalfWidth = wallItemHalfWidth(item);
    if (wall === "left" || wall === "right") {
      const anchored = anchoredAxisPosition(x, presetDepth, sceneDepth, depthRatio, 0.85);
      x = clampNumber(anchored.value, -sceneDepth / 2 + itemHalfWidth, sceneDepth / 2 - itemHalfWidth);
      z = x;
      anchorMeta = { axis: anchored.anchor, wall };
    } else {
      const anchored = anchoredAxisPosition(x, presetWidth, sceneWidth, widthRatio, 0.85);
      x = clampNumber(anchored.value, -sceneWidth / 2 + itemHalfWidth, sceneWidth / 2 - itemHalfWidth);
      z = -sceneDepth / 2 + wallThickness;
      anchorMeta = { x: anchored.anchor, wall: wall || "back" };
    }
  } else {
    const anchoredX = anchoredAxisPosition(x, presetWidth, sceneWidth, widthRatio);
    const anchoredZ = anchoredAxisPosition(z, presetDepth, sceneDepth, depthRatio);
    x = clampNumber(anchoredX.value, -sceneWidth / 2 + 0.35, sceneWidth / 2 - 0.35);
    z = clampNumber(anchoredZ.value, -sceneDepth / 2 + 0.35, sceneDepth / 2 - 0.35);
    anchorMeta = { x: anchoredX.anchor, z: anchoredZ.anchor };
  }

  return { ...item, x, z, y: Number(item.y || 0), rotation: Number(item.rotation || 0), wall, anchorMeta };
}

function isPresetWallItem(item: any) {
  const type = String(item.type || "");
  const config = item.config || {};
  return type === "screen" || type === "poster" || Boolean(item.wall || config.wall);
}

function wallItemHalfWidth(item: any) {
  if (item.type === "poster") return 0.25;
  const bounds = item.config?.dimensions?.placementBounds;
  const boundedWidth = Number(bounds?.maxX) - Number(bounds?.minX);
  if (Number.isFinite(boundedWidth) && boundedWidth > 0) return Math.max(0.08, boundedWidth / 2);

  const size = item.config?.dimensions?.size || item.config?.dimensions?.dimensions || item.config?.modelSize;
  const modelWidth = Array.isArray(size) ? Number(size[0]) : 0;
  if (Number.isFinite(modelWidth) && modelWidth > 0) return Math.max(0.08, modelWidth / 2);

  return 0.3;
}

function anchoredAxisPosition(value: number, presetLength: number, sceneLength: number, ratio: number, maxAnchorDistance = 1.6) {
  const safePresetLength = Math.max(Number(presetLength || 0), 0.01);
  const safeSceneLength = Math.max(Number(sceneLength || 0), 0.01);
  const distanceFromMin = value + safePresetLength / 2;
  const distanceFromMax = safePresetLength / 2 - value;
  const threshold = Math.min(maxAnchorDistance, safePresetLength * 0.35);

  if (distanceFromMin >= 0 && distanceFromMin <= threshold && distanceFromMin <= distanceFromMax) {
    return { value: -safeSceneLength / 2 + distanceFromMin, anchor: "min" };
  }

  if (distanceFromMax >= 0 && distanceFromMax <= threshold) {
    return { value: safeSceneLength / 2 - distanceFromMax, anchor: "max" };
  }

  return { value: value * ratio, anchor: "scaled" };
}

function clampNumber(value: number, min: number, max: number) {
  if (min > max) return value;
  return Math.min(max, Math.max(min, value));
}

function clientKey(email: string, fallback: string) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  return `name:${normalizeText(fallback).replace(/\s+/g, " ") || crypto.randomUUID()}`;
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase() || null;
}

function readColumn(item: any, columnId?: string) {
  if (!columnId) return "";
  return item.column_values?.find((column: any) => column.id === columnId)?.text ?? "";
}

function readColumnAny(item: any, keys: string[]) {
  for (const key of keys) {
    const direct = readColumn(item, key);
    if (direct) return direct;
  }
  const normalizedKeys = keys.map(normalizeColumnLookup).filter(Boolean);
  return item.column_values?.find((column: any) => {
    const candidates = [column.id, column.title, column.column?.title];
    return candidates.some((candidate) => normalizedKeys.includes(normalizeColumnLookup(candidate)));
  })?.text ?? "";
}

function normalizeColumnLookup(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º]/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
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

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
