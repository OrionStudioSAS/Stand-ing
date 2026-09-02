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
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Stand-ING <no-reply@stand-ing.com>";
  const sftpGatewayUrl = Deno.env.get("SFTP_GATEWAY_URL") || "";
  const sftpGatewayToken = Deno.env.get("SFTP_GATEWAY_TOKEN") || Deno.env.get("GATEWAY_API_TOKEN") || "";

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

  const body = await req.json().catch(() => ({}));

  if (body?.recreateSftpFoldersOnly) {
    const warnings: string[] = [];
    const { data: scenes, error: sceneError } = await supabase
      .from("scenes")
      .select("id, share_token, client_name, project_name, event_name, salon, offer, source_payload")
      .in("offer", ["Confort", "CONFORT", "Prestige", "PRESTIGE"]);
    if (sceneError) return json({ error: sceneError.message }, 500);

    let created = 0;
    let skipped = 0;
    for (const scene of scenes || []) {
      const result = await ensureSceneSftpFolder({
        gatewayUrl: sftpGatewayUrl,
        gatewayToken: sftpGatewayToken,
        scene,
        warnings,
      });
      if (result.created) created += 1;
      if (result.skipped) skipped += 1;
    }
    return json({ recreated: created, skipped, warnings });
  }

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
  let inviteEmailsSent = 0;
  let inviteEmailsSkipped = 0;
  let mondayStatusUpdated = 0;
  let skippedMissingLayout = 0;
  let skippedNotConfigurable = 0;
  let skippedNotFirstSend = 0;
  let sftpFoldersCreated = 0;
  let sftpFoldersSkipped = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const source of sources ?? []) {
    const { columns: mondayColumns, warning: columnWarning } = await fetchMondayBoardColumnsSafe(mondayToken, source.board_id);
    if (columnWarning) warnings.push(columnWarning);
    if (mondayColumns.length) {
      warnings.push(...mondayConstraintColumnMessages(source.board_id, mondayColumns));
    }
    const resolvedSource = withResolvedMondayColumns(source, mondayColumns, warnings);
    const context = await ensureSourceContext(supabase, resolvedSource);
    const items = await fetchMondayItems(mondayToken, resolvedSource.board_id, resolvedSource.group_id);

    for (const item of items) {
      const { data: existingScene, error: existingSceneError } = await supabase
        .from("scenes")
        .select("id, share_token, source_payload, width_m, depth_m, client_email, client_name, project_name, event_name, salon, offer")
        .eq("monday_item_id", item.id)
        .maybeSingle();
      if (existingSceneError) throw existingSceneError;

      const createValue = readColumn(item, resolvedSource.create_column_id);
      const stepOneValue = readColumn(item, resolvedSource.status_column_id);
      const shouldCreateScene = isConfigurableYes(createValue);
      const isFirstSendRequested = isFirstSendStatusValue(stepOneValue);

      if (existingScene) {
        const existingWidth = Number(existingScene.width_m) || Number(readMappingValue(item, resolvedSource.mapping?.width_m)) || 4;
        const existingDepth = Number(existingScene.depth_m) || Number(readMappingValue(item, resolvedSource.mapping?.depth_m)) || 3;
        const constraints = mondayConstraintsForItem(item, resolvedSource, existingWidth, existingDepth);
        const constraint = constraints[0] || null;
        const mappedClientEmail = readMappingValue(item, resolvedSource.mapping?.client_email);
        const mappedClientName = readMappingValue(item, resolvedSource.mapping?.client_name) || item.name;
        const mappedLocation = mondaySceneLocation(item, resolvedSource);
        const scenePatch: Record<string, unknown> = {
          source_payload: {
            ...(existingScene.source_payload || {}),
            stand_number: mappedLocation.standNumber || existingScene.source_payload?.stand_number || "",
            aisle_number: mappedLocation.aisleNumber || existingScene.source_payload?.aisle_number || "",
            hall: mappedLocation.hall || existingScene.source_payload?.hall || "",
            sector: mappedLocation.sector || existingScene.source_payload?.sector || "",
            constraint,
            constraints,
            poteau_1_text: mondayPoleRawText(item, resolvedSource, 1),
            poteau_2_text: mondayPoleRawText(item, resolvedSource, 2),
          },
        };
        if (!clean(existingScene.client_email) && mappedClientEmail) scenePatch.client_email = mappedClientEmail;
        if (!clean(existingScene.client_name) && mappedClientName) scenePatch.client_name = mappedClientName;
        const hasLocationPatch = Boolean(mappedLocation.standNumber || mappedLocation.aisleNumber || mappedLocation.hall || mappedLocation.sector);
        const hasScenePatch = Object.keys(scenePatch).some((key) => key !== "source_payload")
          || constraintColumnsConfigured(resolvedSource)
          || Boolean(constraint)
          || constraints.length > 0
          || hasLocationPatch;
        if (hasScenePatch) {
          const { error: updateConstraintError } = await supabase
            .from("scenes")
            .update(scenePatch)
            .eq("id", existingScene.id);
          if (updateConstraintError) throw updateConstraintError;
          if (constraintColumnsConfigured(resolvedSource) || constraint) constraintsUpdated += 1;
        }

        if (shouldCreateScene) {
          await ensureMondayConfiguratorLink({
            mondayToken,
            publicAppUrl,
            shareToken: existingScene.share_token,
            source: resolvedSource,
            item,
          });

          const sftpFolderResult = await ensureSceneSftpFolder({
            gatewayUrl: sftpGatewayUrl,
            gatewayToken: sftpGatewayToken,
            scene: { ...existingScene, ...scenePatch, source_payload: scenePatch.source_payload },
            warnings,
          });
          if (sftpFolderResult.created) sftpFoldersCreated += 1;
          if (sftpFolderResult.skipped) sftpFoldersSkipped += 1;
        }

        const hasInviteAlreadyBeenSent = Boolean(existingScene.source_payload?.invitation_email_sent_at);
        const shouldSendMissingInvite = shouldCreateScene
          && isFirstSendRequested
          && !hasInviteAlreadyBeenSent;
        if (shouldSendMissingInvite) {
          const inviteScene = {
            ...existingScene,
            ...scenePatch,
            client_email: clean(String(scenePatch.client_email || "")) || existingScene.client_email,
            client_name: clean(String(scenePatch.client_name || "")) || existingScene.client_name,
          };
          const inviteResult = await sendInvitationAndUpdateMonday({
            supabase,
            mondayToken,
            resendApiKey,
            fromEmail,
            publicAppUrl,
            scene: inviteScene,
            sceneId: existingScene.id,
            shareToken: existingScene.share_token,
            source: resolvedSource,
            context,
            item,
            mondayColumns,
            warnings,
          });
          inviteEmailsSent += inviteResult.sent;
          inviteEmailsSkipped += inviteResult.skipped;
          mondayStatusUpdated += inviteResult.statusUpdated;
        } else if (shouldCreateScene && !isFirstSendRequested && !hasInviteAlreadyBeenSent) {
          skippedNotFirstSend += 1;
        }

        continue;
      }

      if (!shouldCreateScene) {
        skippedNotConfigurable += 1;
        continue;
      }

      const rawLayout = readMondayLayoutValue(item, resolvedSource);
      const parsedLayout = normalizeMondayLayoutStrict(rawLayout);
      if (!parsedLayout) {
        skippedMissingLayout += 1;
        errors.push(missingLayoutSyncError(item, resolvedSource, context, rawLayout));
        continue;
      }

      const userProfile = mapMondayItemToUserProfile(item, resolvedSource, context);
      const { data: savedProfile, error: profileError } = await supabase
        .from("user_profiles")
        .upsert(userProfile, { onConflict: "profile_key" })
        .select("id")
        .single();
      if (profileError) throw profileError;

      const client = mapMondayItemToClient(item, resolvedSource, savedProfile?.id, context);
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

      const sceneDraft = mapMondayItemToScene(item, resolvedSource, savedClient?.id, savedProfile?.id, context, parsedLayout);
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

      await ensureMondayConfiguratorLink({
        mondayToken,
        publicAppUrl,
        shareToken: savedScene.share_token,
        source: resolvedSource,
        item,
      });

      const sftpFolderResult = await ensureSceneSftpFolder({
        gatewayUrl: sftpGatewayUrl,
        gatewayToken: sftpGatewayToken,
        scene: { ...scene, id: savedScene.id, share_token: savedScene.share_token },
        warnings,
      });
      if (sftpFolderResult.created) sftpFoldersCreated += 1;
      if (sftpFolderResult.skipped) sftpFoldersSkipped += 1;

      if (savedScene?.id && preset?.stand_preset_items?.length) {
        const inserted = await applyPresetItems(supabase, savedScene.id, preset, scene);
        baseItemsApplied += inserted;
      }

      if (isFirstSendRequested) {
        const inviteResult = await sendInvitationAndUpdateMonday({
          supabase,
          mondayToken,
          resendApiKey,
          fromEmail,
          publicAppUrl,
          scene,
          sceneId: savedScene.id,
          shareToken: savedScene.share_token,
          source: resolvedSource,
          context,
          item,
          mondayColumns,
          warnings,
        });
        inviteEmailsSent += inviteResult.sent;
        inviteEmailsSkipped += inviteResult.skipped;
        mondayStatusUpdated += inviteResult.statusUpdated;
      } else {
        skippedNotFirstSend += 1;
      }

      processed += 1;
      clients += 1;
      exhibitors += 1;
    }
  }

  await supabase.from("monday_sync_runs").insert({ status: "success", processed_count: processed });
  return json({
    processed,
    created: processed,
    clients,
    exhibitors,
    base_items_applied: baseItemsApplied,
    constraints_updated: constraintsUpdated,
    invite_emails_sent: inviteEmailsSent,
    invite_emails_skipped: inviteEmailsSkipped,
    monday_status_updated: mondayStatusUpdated,
    sftp_folders_created: sftpFoldersCreated,
    sftp_folders_skipped: sftpFoldersSkipped,
    skipped_missing_layout: skippedMissingLayout,
    skipped_not_configurable: skippedNotConfigurable,
    skipped_not_first_send: skippedNotFirstSend,
    errors,
    warnings,
  });
});

function withResolvedMondayColumns(source: any, columns: Array<{ id: string; title: string; type?: string }>, warnings: string[] = []) {
  const mapping = source.mapping ?? {};
  const clientEmailColumnId = resolveMappedColumnId(columns, mapping.client_email, findEmailColumnId(columns));
  const layoutColumnId = resolveMappedColumnId(columns, mapping.layout, findLayoutColumnId(columns));
  const hallColumnId = findHallColumnId(columns) || resolveMappedColumnId(columns, mapping.hall || mapping.pavillon, '');
  const aisleColumnId = findAisleColumnId(columns) || resolveMappedColumnId(columns, mapping.aisle_number || mapping.allee || mapping["allée"], '');
  const standNumberColumnId = findStandNumberColumnId(columns) || resolveMappedColumnId(columns, mapping.stand_number || mapping.standNumber || mapping.numero_stand || mapping["numéro_stand"], '');
  const constraintColumnId = mapping.constraint || mapping.contrainte || findConstraintSizeColumnId(columns);
  const constraintLocationColumnId = mapping.constraint_location
    || mapping.emplacement_contrainte
    || findConstraintLocationColumnId(columns);
  const pole1ColumnId = resolveMappedColumnId(columns, mappedPoleColumnId(mapping, 1), findPoleColumnId(columns, 1));
  const pole2ColumnId = resolveMappedColumnId(columns, mappedPoleColumnId(mapping, 2), findPoleColumnId(columns, 2));
  const statusColumnId = resolveMappedColumnId(columns, source.status_column_id, findStatusColumnId(columns));
  const createColumnId = resolveMappedColumnId(columns, source.create_column_id, findConfigurableColumnId(columns));
  const linkColumnId = resolveMappedColumnId(columns, source.link_column_id, findLinkColumnId(columns));

  if (mapping.client_email && clientEmailColumnId && mapping.client_email !== clientEmailColumnId) {
    warnings.push(`Colonne email corrigée sur le board ${source.board_id}: ${mapping.client_email} → ${clientEmailColumnId}`);
  }
  if (source.status_column_id && statusColumnId && source.status_column_id !== statusColumnId) {
    warnings.push(`Colonne Étape 1 corrigée sur le board ${source.board_id}: ${source.status_column_id} → ${statusColumnId}`);
  }
  if (source.create_column_id && createColumnId && source.create_column_id !== createColumnId) {
    warnings.push(`Colonne CONFIGURABLE corrigée sur le board ${source.board_id}: ${source.create_column_id} → ${createColumnId}`);
  }
  if (mapping.layout && layoutColumnId && mapping.layout !== layoutColumnId) {
    warnings.push(`Colonne implantation corrigée sur le board ${source.board_id}: ${mapping.layout} → ${layoutColumnId}`);
  }

  return {
    ...source,
    status_column_id: statusColumnId || source.status_column_id,
    create_column_id: createColumnId || source.create_column_id,
    link_column_id: linkColumnId || source.link_column_id,
    mapping: {
      ...mapping,
      ...(clientEmailColumnId ? { client_email: clientEmailColumnId } : {}),
      ...(layoutColumnId ? { layout: layoutColumnId } : {}),
      ...(hallColumnId ? { hall: hallColumnId } : {}),
      ...(aisleColumnId ? { aisle_number: aisleColumnId, allee: aisleColumnId } : {}),
      ...(standNumberColumnId ? { stand_number: standNumberColumnId } : {}),
      ...(constraintColumnId ? { constraint: constraintColumnId } : {}),
      ...(constraintLocationColumnId ? { constraint_location: constraintLocationColumnId } : {}),
      ...(pole1ColumnId ? { poteau_1: pole1ColumnId } : {}),
      ...(pole2ColumnId ? { poteau_2: pole2ColumnId } : {}),
    },
  };
}

function resolveMappedColumnId(columns: Array<{ id: string }>, configuredId = "", fallbackId = "") {
  if (configuredId && columnExists(columns, configuredId)) return configuredId;
  return fallbackId || configuredId || "";
}

function columnExists(columns: Array<{ id: string }>, columnId = "") {
  return Boolean(columnId && columns.some((column) => column.id === columnId));
}

function mondayConstraintColumnMessages(boardId: string, columns: Array<{ id: string; title: string }>) {
  const messages: string[] = [];
  const sizeColumnId = findConstraintSizeColumnId(columns);
  const pole1ColumnId = findPoleColumnId(columns, 1);
  const pole2ColumnId = findPoleColumnId(columns, 2);

  if (sizeColumnId) messages.push(`ID colonne Contrainte détecté sur le board ${boardId}: ${sizeColumnId}`);
  if (pole1ColumnId) messages.push(`ID colonne POTEAU 1 détecté sur le board ${boardId}: ${pole1ColumnId}`);
  if (pole2ColumnId) messages.push(`ID colonne POTEAU 2 détecté sur le board ${boardId}: ${pole2ColumnId}`);

  if (!sizeColumnId && !pole1ColumnId && !pole2ColumnId) {
    messages.push(`Colonnes disponibles sur le board ${boardId}: ${formatMondayColumnList(columns)}`);
  }

  if (!sizeColumnId && !pole1ColumnId && !pole2ColumnId) messages.push(`Colonne Monday manquante sur le board ${boardId}: Contrainte / POTEAU 1 / POTEAU 2`);
  return messages;
}

function formatMondayColumnList(columns: Array<{ id: string; title: string }>) {
  return columns.map((column) => `${column.title || '(sans titre)'} [${column.id}]`).join(' | ');
}

function findStatusColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "etape_1" || value === "etape1")
    || findMondayColumnId(columns, (value) => value.includes("etape_1") || value.includes("etape1"));
}

function findConfigurableColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "configurable")
    || findMondayColumnId(columns, (value) => value.includes("configurable"));
}

function findEmailColumnId(columns: Array<{ id: string; title: string; type?: string }>) {
  return columns.find((column) => column.type === "email")?.id
    || findMondayColumnId(columns, (value) => value === "email" || value === "e_mail" || value.includes("email"));
}

function findLinkColumnId(columns: Array<{ id: string; title: string; type?: string }>) {
  return columns.find((column) => column.type === "link")?.id
    || findMondayColumnId(columns, (value) => value.includes("lien") || value.includes("link") || value.includes("configurateur"));
}

function findLayoutColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "implantation" || value === "layout" || value === "disposition")
    || findMondayColumnId(columns, (value) => value.includes("implantation"));
}

function findHallColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "hall" || value === "pavillon");
}

function findAisleColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "allee" || value === "allee_stand");
}

function findStandNumberColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "n" || value === "numero" || value === "numero_stand");
}

function isConfigurableYes(value = "") {
  return normalizeText(value) === normalizeText("OUI");
}

function isFirstSendStatusValue(value = "") {
  return normalizeText(value) === normalizeText("1ER ENVOI")
    || (normalizeText(value).includes("1er") && normalizeText(value).includes("envoi"));
}

function mondayStatusLabel(columns: Array<any>, columnId = "", configuredLabel = "") {
  const cleanConfigured = clean(configuredLabel);
  const column = columns.find((entry) => entry.id === columnId);
  const labels = mondayColumnLabels(column);
  const firstSendLabel = "1ER ENVOI";
  const candidates = [
    firstSendLabel,
    cleanConfigured && normalizeText(cleanConfigured) === normalizeText(firstSendLabel) ? cleanConfigured : "",
    "1er envoi",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const found = labels.find((label) => normalizeText(label) === normalizeText(candidate));
    if (found) return found;
  }
  const firstSendFallback = labels.find((label) => normalizeText(label).includes("1er") && normalizeText(label).includes("envoi"));
  if (firstSendFallback) return firstSendFallback;
  if (cleanConfigured) return cleanConfigured;
  return firstSendLabel;
}

function mondayColumnLabels(column: any) {
  if (!column?.settings_str) return [] as string[];
  try {
    const settings = JSON.parse(column.settings_str);
    const labels = settings?.labels || {};
    const positions = settings?.labels_positions_v2 || {};
    return Object.keys(labels)
      .sort((a, b) => Number(positions[a] ?? 999) - Number(positions[b] ?? 999))
      .map((key) => clean(labels[key]))
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
}

function findConstraintSizeColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value === "contrainte")
    || findMondayColumnId(columns, (value) => value.includes("contrainte") && !value.includes("emplacement") && !value.includes("empacement"));
}

function findConstraintLocationColumnId(columns: Array<{ id: string; title: string }>) {
  return findMondayColumnId(columns, (value) => value.includes("contrainte") && (value.includes("emplacement") || value.includes("empacement")));
}

function findPoleColumnId(columns: Array<{ id: string; title: string }>, poleNumber: number) {
  const number = String(poleNumber);
  return findMondayColumnId(columns, (value) => value === `poteau_${number}` || value === `poteau${number}` || value === `pole_${number}` || value === `pole${number}`)
    || findMondayColumnId(columns, (value) => (value.includes("poteau") || value.includes("pole")) && value.includes(number));
}

function mappedPoleColumnId(mapping: Record<string, string> = {}, poleNumber: number) {
  const number = String(poleNumber);
  return mapping[`poteau_${number}`]
    || mapping[`poteau${number}`]
    || mapping[`pole_${number}`]
    || mapping[`pole${number}`]
    || "";
}

function findMondayColumnId(columns: Array<{ id: string; title: string }>, predicate: (value: string) => boolean) {
  return columns.find((column) => [column.title, column.id].some((candidate) => predicate(normalizeColumnLookup(candidate))))?.id || "";
}

function constraintColumnsConfigured(source: any) {
  const mapping = source.mapping ?? {};
  return Boolean(mapping.constraint || mapping.contrainte || mappedPoleColumnId(mapping, 1) || mappedPoleColumnId(mapping, 2));
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
        columns { id title type settings_str }
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
    .map((column: any) => ({
      id: String(column.id || ""),
      title: String(column.title || ""),
      type: String(column.type || ""),
      settings_str: String(column.settings_str || ""),
    }))
    .filter((column: any) => column.id);
}

async function ensureSourceContext(supabase: any, source: any) {
  if (source.salon_id) {
    const { data: salon, error: salonError } = await supabase
      .from("salons")
      .select("name")
      .eq("id", source.salon_id)
      .maybeSingle();
    if (salonError) throw salonError;
    return { salonId: source.salon_id, offerId: source.offer_id || null, salonLabel: salon?.name || source.salon || "Salon" };
  }

  const fallbackSalonName = salonDisplayName(source.salon || "Salon");
  const salonSlug = slugify(fallbackSalonName);
  const { data: salon, error: salonError } = await supabase
    .from("salons")
    .upsert({
      slug: salonSlug,
      name: fallbackSalonName,
      year: 2026,
      status: "draft",
      metadata: { source: "monday_sync_fallback" },
      updated_at: new Date().toISOString(),
    }, { onConflict: "slug" })
    .select("id, name")
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
  return { salonId: salon.id, offerId: offer.id, salonLabel: salon.name || fallbackSalonName };
}

function salonDisplayName(value = "") {
  const clean = String(value || "Salon").trim() || "Salon";
  return /\b20\d{2}\b/.test(clean) ? clean : `${clean} 2026`;
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

function mapMondayItemToUserProfile(item: any, source: any, context: any) {
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
      salon: context.salonLabel || source.salon,
      offer: source.offer,
    },
    updated_at: new Date().toISOString(),
  };
}

function mapMondayItemToClient(item: any, source: any, userProfileId?: string, context?: any) {
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
      salon: context?.salonLabel || source.salon,
      offer: source.offer,
    },
    updated_at: new Date().toISOString(),
  };
}

function mapMondayItemToScene(item: any, source: any, clientId: string | undefined, userProfileId: string | undefined, context: any, layoutOverride = "") {
  const mapping = source.mapping ?? {};
  const { width, depth } = mondaySceneDimensions(item, source);
  const layout = layoutOverride || normalizeLayout(readMondayLayoutValue(item, source));
  const clientName = readMappingValue(item, mapping.client_name) || item.name;
  const location = mondaySceneLocation(item, source);
  const { standNumber, aisleNumber, hall, sector } = location;
  const constraints = mondayConstraintsForItem(item, source, width, depth);
  const constraint = constraints[0] || null;

  return {
    monday_item_id: item.id,
    monday_board_id: source.board_id,
    monday_group_id: source.group_id,
    salon: context.salonLabel || source.salon,
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
    event_name: context.salonLabel || source.salon,
    width_m: width,
    depth_m: depth,
    height_m: 2.5,
    layout,
    source_payload: {
      ...item,
      stand_number: standNumber,
      aisle_number: aisleNumber,
      hall,
      sector,
      constraint,
      constraints,
      poteau_1_text: mondayPoleRawText(item, source, 1),
      poteau_2_text: mondayPoleRawText(item, source, 2),
    },
  };
}


function mondaySceneLocation(item: any, source: any) {
  const mapping = source.mapping ?? {};
  return {
    standNumber: readMappingValue(item, mapping.stand_number || mapping.standNumber || mapping.numero_stand || mapping["numéro_stand"])
      || readColumnTitleAny(item, ["n°", "n", "numero", "numéro", "numero stand", "numéro stand"])
      || readColumnAny(item, ["stand", "emplacement"]),
    aisleNumber: readMappingValue(item, mapping.aisle_number || mapping.allee || mapping["allée"])
      || readColumnAny(item, ["allée", "allee", "allee stand", "allée stand"]),
    hall: readMappingValue(item, mapping.hall || mapping.pavillon)
      || readColumnAny(item, ["hall", "pavillon"]),
    sector: readMappingValue(item, mapping.sector || mapping.secteur)
      || readColumnAny(item, ["dup__of_secteur1", "secteur", "secteur activité", "secteur d'activité"]),
  };
}

function mondayPoleRawText(item: any, source: any, poleNumber: number) {
  const mapping = source.mapping ?? {};
  return readMappingValue(item, mappedPoleColumnId(mapping, poleNumber))
    || readColumnAny(item, [`poteau ${poleNumber}`, `poteau_${poleNumber}`, `poteau${poleNumber}`, `pole ${poleNumber}`, `pole_${poleNumber}`, `pole${poleNumber}`]);
}

async function ensureSceneSftpFolder({ gatewayUrl, gatewayToken, scene, warnings }: { gatewayUrl: string; gatewayToken: string; scene: any; warnings: string[] }) {
  if (!gatewayUrl || !gatewayToken || !scene?.id) return { created: false, skipped: true };

  try {
    const sourcePayload = scene.source_payload || {};
    const hall = readColumnAny(sourcePayload, ["hall", "pavillon"]) || sourcePayload.hall || "";
    const aisle = readColumnAny(sourcePayload, ["allée", "allee", "allee stand", "allée stand"]) || sourcePayload.aisle_number || sourcePayload.allee || "";
    const standNumber = readColumnTitleAny(sourcePayload, ["n°", "n", "numero", "numéro", "numero stand", "numéro stand"]) || sourcePayload.stand_number || "";
    const response = await fetch(`${gatewayUrl.replace(/\/+$/g, "")}/scene-folder`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sceneId: scene.id,
        sceneToken: scene.share_token || "",
        salon: scene.salon || scene.event_name || scene.source_payload?.salon || "",
        offer: scene.offer || scene.source_payload?.offer || scene.source_payload?.pack || "",
        company: sceneCompanyNameForSftp(scene),
        hall,
        aisle,
        standNumber,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.message || payload?.error || `Gateway ${response.status}`);
    return { created: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Dossier SFTP non créé pour ${scene.project_name || scene.client_name || scene.id}: ${message}`);
    return { created: false, skipped: true };
  }
}

function sceneCompanyNameForSftp(scene: any) {
  const source = scene?.source_payload || {};
  const contact = source.contactDetails || {};
  return clean(
    contact.company
    || source.company_name
    || source.company
    || source.name
    || source.item?.name
    || scene.project_name
    || scene.client_name
    || source.client_name
    || "EXPOSANT"
  );
}

function mondaySceneDimensions(item: any, source: any) {
  const mapping = source.mapping ?? {};
  return {
    width: Number(readMappingValue(item, mapping.width_m)) || 4,
    depth: Number(readMappingValue(item, mapping.depth_m)) || 3,
  };
}

function mondayConstraintForItem(item: any, source: any, width = 0, depth = 0) {
  return mondayConstraintsForItem(item, source, width, depth)[0] || null;
}

function mondayConstraintsForItem(item: any, source: any, width = 0, depth = 0) {
  const mapping = source.mapping ?? {};
  const constraints = [
    parseSceneConstraint(
      readMappingValue(item, mappedPoleColumnId(mapping, 1)) || readColumnAny(item, ["poteau 1", "poteau_1", "poteau1", "pole 1", "pole_1", "pole1"]),
      "",
      width,
      depth,
      "Poteau 1",
      { forceMillimeters: true },
    ),
    parseSceneConstraint(
      readMappingValue(item, mappedPoleColumnId(mapping, 2)) || readColumnAny(item, ["poteau 2", "poteau_2", "poteau2", "pole 2", "pole_2", "pole2"]),
      "",
      width,
      depth,
      "Poteau 2",
      { forceMillimeters: true },
    ),
    mondayLegacyConstraintForItem(item, source, width, depth),
  ].filter(Boolean);

  return dedupeSceneConstraints(constraints);
}

function mondayLegacyConstraintForItem(item: any, source: any, width = 0, depth = 0) {
  const mapping = source.mapping ?? {};
  return parseSceneConstraint(
    readMappingValue(item, mapping.constraint || mapping.contrainte) || readColumnAny(item, ["contrainte"]),
    readMappingValue(item, mapping.constraint_location || mapping.emplacement_contrainte) || readColumnAny(item, ["emplacement contrainte", "emplacement_contrainte", "empacement contrainte"]),
    width,
    depth,
    "Poteau",
  );
}

function dedupeSceneConstraints(constraints: any[]) {
  const seen = new Set<string>();
  return constraints.filter((constraint) => {
    const key = [
      Math.round(Number(constraint.width || 0) * 1000),
      Math.round(Number(constraint.depth || 0) * 1000),
      Math.round(Number(constraint.x || 0) * 1000),
      Math.round(Number(constraint.z || 0) * 1000),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSceneConstraint(sizeValue = "", locationValue = "", width = 0, depth = 0, label = "Poteau", options: Record<string, boolean> = {}) {
  const combined = parseCombinedConstraintValue(sizeValue);
  const sizeParts = combined?.sizeParts || parseNumberParts(sizeValue);
  const locationParts = combined?.locationParts || parseNumberParts(locationValue);
  if (sizeParts.length < 2 || locationParts.length < 2) return null;

  const forceMillimeters = Boolean(options.forceMillimeters);
  const sizeDivisor = forceMillimeters || combined?.sizeUnit === "mm" ? 1000 : sizeParts.some((value) => value > 100) ? 1000 : 100;
  const locationDivisor = forceMillimeters || combined?.locationUnit === "mm" ? 1000 : locationParts.some((value) => value > 50) ? 1000 : 1;
  const sizeX = sizeParts[0] / sizeDivisor;
  const sizeZ = sizeParts[1] / sizeDivisor;
  const fromLeft = locationParts[0] / locationDivisor;
  const fromBack = locationParts[1] / locationDivisor;
  if (![sizeX, sizeZ, fromLeft, fromBack].every((value) => Number.isFinite(value) && value >= 0)) return null;

  return {
    rawSize: String(sizeValue || "").trim(),
    rawLocation: String(locationValue || "").trim(),
    id: slugify(`${label}-${sizeValue}-${locationValue}`),
    label,
    width: Math.max(0.01, sizeX),
    depth: Math.max(0.01, sizeZ),
    height: 5,
    fromLeft,
    fromBack,
    x: clampNumber(-Number(width || 0) / 2 + fromLeft + sizeX / 2, -Number(width || 0) / 2 + sizeX / 2, Number(width || 0) / 2 - sizeX / 2),
    z: clampNumber(-Number(depth || 0) / 2 + fromBack + sizeZ / 2, -Number(depth || 0) / 2 + sizeZ / 2, Number(depth || 0) / 2 - sizeZ / 2),
  };
}

function parseCombinedConstraintValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/([0-9]+(?:[.,][0-9]+)?)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)(?:[^\d]+|\s*)\(?\s*([0-9]+(?:[.,][0-9]+)?)\s*[-–—;x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*\)?/i);
  if (!match) return null;
  const values = match.slice(1, 5).map((part) => Number(String(part).replace(",", ".")));
  if (!values.every((part) => Number.isFinite(part))) return null;
  return {
    sizeParts: values.slice(0, 2),
    locationParts: values.slice(2, 4),
    sizeUnit: values.slice(0, 2).some((part) => part > 100) ? "mm" : "cm",
    locationUnit: values.slice(2, 4).some((part) => part > 50) ? "mm" : "m",
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

async function sendInvitationAndUpdateMonday({
  supabase,
  mondayToken,
  resendApiKey,
  fromEmail,
  publicAppUrl,
  scene,
  sceneId,
  shareToken,
  source,
  context,
  item,
  mondayColumns,
  warnings,
}: {
  supabase: any;
  mondayToken: string;
  resendApiKey: string;
  fromEmail: string;
  publicAppUrl: string;
  scene: any;
  sceneId: string;
  shareToken: string;
  source: any;
  context: any;
  item: any;
  mondayColumns: Array<any>;
  warnings: string[];
}) {
  const shareUrl = configuratorShareUrl(publicAppUrl, shareToken);

  const inviteResult = await sendConfiguratorInvitationEmail({
    resendApiKey,
    fromEmail,
    scene,
    source,
    context,
    item,
    shareUrl,
  });

  if (!inviteResult.sent) {
    if (inviteResult.reason) warnings.push(`Email non envoyé pour ${item.name}: ${inviteResult.reason}`);
    return { sent: 0, skipped: 1, statusUpdated: 0 };
  }

  await supabase.from("scenes").update({
    source_payload: {
      ...(scene.source_payload || {}),
      invitation_email_sent_at: new Date().toISOString(),
      invitation_email_to: inviteResult.to,
      invitation_email_provider_id: inviteResult.providerId || null,
    },
  }).eq("id", sceneId);

  return { sent: 1, skipped: 0, statusUpdated: 0 };
}

function configuratorShareUrl(publicAppUrl: string, shareToken: string) {
  return publicAppUrl && shareToken
    ? `${publicAppUrl.replace(/\/$/, "")}?scene=${shareToken}`
    : "";
}

async function ensureMondayConfiguratorLink({
  mondayToken,
  publicAppUrl,
  shareToken,
  source,
  item,
}: {
  mondayToken: string;
  publicAppUrl: string;
  shareToken: string;
  source: any;
  item: any;
}) {
  const shareUrl = configuratorShareUrl(publicAppUrl, shareToken);
  if (!source.link_column_id || source.link_column_id === source.create_column_id || !shareUrl) return;

  await updateMondayColumnValue(mondayToken, source.board_id, item.id, source.link_column_id, {
    url: shareUrl,
    text: "Configurer mon stand",
  });
}

async function sendConfiguratorInvitationEmail({
  resendApiKey,
  fromEmail,
  scene,
  source,
  context,
  item,
  shareUrl,
}: {
  resendApiKey: string;
  fromEmail: string;
  scene: any;
  source: any;
  context: any;
  item: any;
  shareUrl: string;
}) {
  const toEmails = normalizeEmailRecipients(scene.client_email);
  if (!resendApiKey) return { sent: false, reason: "RESEND_API_KEY manquant" };
  if (!toEmails.length) return { sent: false, reason: "email exposant manquant ou invalide" };
  if (!shareUrl) return { sent: false, reason: "lien configurateur manquant" };

  const firstName = firstNameFromMondayItem(item, source) || "client";
  const salonName = clean(context?.salonLabel || source?.salon || scene?.salon || "votre salon");
  const offerName = clean(source?.offer || scene?.offer || "CONFORT").toUpperCase();
  const subject = `Votre stand ${offerName} sur le salon ${salonName}`;
  const html = invitationEmailHtml({ firstName, salonName, offerName, sceneUrl: shareUrl });
  const text = invitationEmailText({ firstName, salonName, offerName, sceneUrl: shareUrl });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmails,
      subject,
      html,
      text,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { sent: false, reason: result?.message || "erreur Resend" };
  }
  return { sent: true, to: toEmails.join(", "), providerId: result?.id || null };
}

function normalizeEmailRecipients(value: string) {
  return [...new Set(String(value || "")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
    ?.map((email) => normalizeEmail(email))
    .filter(Boolean) || [])];
}

function firstNameFromMondayItem(item: any, source: any) {
  const mapping = source?.mapping ?? {};
  const direct = readMappingValue(item, mapping.first_name || mapping.client_first_name || mapping.prenom || mapping["prénom"])
    || readColumnAny(item, ["prenom", "prénom", "first_name", "texte2"]);
  if (direct) return firstWord(direct);
  const contact = readMappingValue(item, mapping.contact_name) || readMappingValue(item, mapping.contact);
  if (contact) return firstWord(contact);
  return firstWord(readMappingValue(item, mapping.client_name) || item?.name || "");
}

function firstWord(value = "") {
  return clean(value).split(/\s+/).find(Boolean) || "";
}

function invitationEmailText({ firstName, salonName, offerName, sceneUrl }: { firstName: string; salonName: string; offerName: string; sceneUrl: string }) {
  return `Bonjour ${firstName},

Dans le cadre de votre participation au prochain Salon ${salonName}, vous avez opté pour un aménagement de stand en formule ${offerName} auprès du ${salonName}.

En cliquant sur le lien ci-dessous vous accéderez au configurateur qui vous permettra de personnaliser votre stand.
Configurer mon stand - ${sceneUrl}

REMARQUE : si votre stand n’est pas configurable, choisissez vos couleurs et options via le configurateur jusqu’à validation et notre service exposant reviendra vers vous dans les plus brefs délais.

Merci.

____________________________________________________

Hello ${firstName},

As part of your participation in the ${salonName}, you have opted for a booth layout in ${offerName} formula.

By clicking on the link below you will access the configurator which will allow you to customize your stand.
Configure my stand - ${sceneUrl}

NOTE: if your stand is not configurable, choose your colors and options via the configurator until validation and our exhibitor service will get back to you as soon as possible.

Thanks.

${emailSignatureText()}`;
}

function invitationEmailHtml({ firstName, salonName, offerName, sceneUrl }: { firstName: string; salonName: string; offerName: string; sceneUrl: string }) {
  const escapedUrl = escapeHtml(sceneUrl);
  return `
  <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55">
    <p>Bonjour ${escapeHtml(firstName)},</p>
    <p>Dans le cadre de votre participation au prochain Salon <strong>${escapeHtml(salonName)}</strong>, vous avez opté pour un aménagement de stand en formule <strong>${escapeHtml(offerName)}</strong> auprès du <strong>${escapeHtml(salonName)}</strong>.</p>
    <p>En cliquant sur le lien ci-dessous vous accéderez au configurateur qui vous permettra de personnaliser votre stand.</p>
    <p><a href="${escapedUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Configurer mon stand</a></p>
    <p><a href="${escapedUrl}" style="color:#1f4378">${escapedUrl}</a></p>
    <p><strong>REMARQUE :</strong> si votre stand n’est pas configurable, choisissez vos couleurs et options via le configurateur jusqu’à validation et notre service exposant reviendra vers vous dans les plus brefs délais.</p>
    <p>Merci.</p>
    <hr style="border:none;border-top:1px solid #d7dde8;margin:24px 0" />
    <p>Hello ${escapeHtml(firstName)},</p>
    <p>As part of your participation in the <strong>${escapeHtml(salonName)}</strong>, you have opted for a booth layout in <strong>${escapeHtml(offerName)}</strong> formula.</p>
    <p>By clicking on the link below you will access the configurator which will allow you to customize your stand.</p>
    <p><a href="${escapedUrl}" style="display:inline-block;background:#1f4378;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold">Configure my stand</a></p>
    <p><a href="${escapedUrl}" style="color:#1f4378">${escapedUrl}</a></p>
    <p><strong>NOTE:</strong> if your stand is not configurable, choose your colors and options via the configurator until validation and our exhibitor service will get back to you as soon as possible.</p>
    <p>Thanks.</p>
    ${emailSignatureHtml()}
  </div>`;
}

function emailSignatureHtml() {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #d7dde8;padding-top:14px;font-family:Arial,sans-serif;color:#172033;line-height:1.35">
      <tr>
        <td style="padding:0 0 4px;font-size:11pt;font-weight:bold;color:#002060">Contact exposant</td>
      </tr>
      <tr>
        <td style="padding:0 0 12px;font-size:10pt;color:#767171">
          <a href="mailto:configurateur@stand-ing.com" style="color:#767171;text-decoration:none">configurateur@stand-ing.com</a>
          <span style="color:#767171"> | +33 (0)1 34 64 64 13</span>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 4px;font-size:11pt;font-weight:bold;color:#002060">Stand-ING | LA FORCE BLEUE</td>
      </tr>
      <tr>
        <td style="padding:0 0 12px;font-size:10pt;color:#767171">
          2 Rue de la Métairie - 95640 MARINES<br />
          T : +33 (0)1 34 30 46 62<br />
          <a href="https://www.stand-ing.com" style="color:#767171;text-decoration:none">www.stand-ing.com</a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 12px">
          <img src="https://mail.stand-ing.com/img/mail/signature-00.png" width="151" height="220" alt="Stand-ING" style="display:inline-block;border:0;vertical-align:top" />
          <img src="https://mail.stand-ing.com/img/mail/signature-02.png" width="360" height="220" alt="EXPOSITION | EVENEMENTIEL | AGENCEMENT" style="display:inline-block;border:0;vertical-align:top" />
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 12px">
          <img src="https://mail.stand-ing.com/img/mail/icone1.png" width="128" height="34" alt="" style="display:inline-block;border:0;vertical-align:middle" />
          <a href="https://www.linkedin.com/company/stand-ing/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone6.png" width="36" height="34" alt="LinkedIn" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.instagram.com/standing_officiel/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone7.png" width="36" height="34" alt="Instagram" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.facebook.com/standing95/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone2.png" width="36" height="34" alt="Facebook" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.youtube.com/channel/UCB_U0sKwdannk3HAowNHlZA" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone3.png" width="36" height="34" alt="Youtube" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://fr.pinterest.com/ing2355/" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone4.png" width="36" height="34" alt="Pinterest" style="display:inline-block;border:0;vertical-align:middle" /></a>
          <a href="https://www.stand-ing.com" style="text-decoration:none"><img src="https://mail.stand-ing.com/img/mail/icone5.png" width="36" height="34" alt="stand-ing.com" style="display:inline-block;border:0;vertical-align:middle" /></a>
        </td>
      </tr>
      <tr>
        <td>
          <img src="https://mail.stand-ing.com/img/mail/pub2.png" width="320" height="75" alt="" style="display:block;border:0" />
        </td>
      </tr>
    </table>`;
}

function emailSignatureText() {
  return `Contact exposant
configurateur@stand-ing.com | +33 (0)1 34 64 64 13

Stand-ING | LA FORCE BLEUE
2 Rue de la Métairie - 95640 MARINES
T : +33 (0)1 34 30 46 62
www.stand-ing.com`;
}
function escapeHtml(value: string) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(value: unknown) {
  return String(value ?? "").trim();
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

function readColumnTitleAny(item: any, keys: string[]) {
  const normalizedKeys = keys.map(normalizeColumnLookup).filter(Boolean);
  return item.column_values?.find((column: any) => {
    const candidates = [column.title, column.column?.title];
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

function readMondayLayoutValue(item: any, source: any) {
  const mapping = source.mapping ?? {};
  return readMappingValue(item, mapping.layout) || readColumnAny(item, ["implantation", "layout", "disposition"]);
}

function normalizeMondayLayoutStrict(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized === "u" || normalized.includes("mur_des_2") || normalized.includes("deux_cotes")) return "u";
  if (normalized.includes("gauche")) return "left";
  if (normalized.includes("droite")) return "right";
  if (normalized.includes("arriere") || normalized.includes("fond")) return "back";
  return "";
}

function missingLayoutSyncError(item: any, source: any, context: any, rawLayout = "") {
  const salon = clean(context?.salonLabel || source?.salon || "Salon");
  const offer = clean(source?.offer || "pack");
  const raw = clean(rawLayout);
  const suffix = raw ? ` Valeur reçue: "${raw}".` : "";
  return `Implantation manquante ou invalide pour "${item.name}" (${salon} / ${offer}). Valeurs attendues: ARRIERE GAUCHE, ARRIERE, ARRIERE DROITE ou U.${suffix} Ligne non créée, lien non généré.`;
}

function normalizeLayout(value: string) {
  return normalizeMondayLayoutStrict(value) || "u";
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
