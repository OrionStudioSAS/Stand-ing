export function sceneEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function sceneActor(admin: any, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data?.user?.email_confirmed_at ? null : data.user;
}

export function isSceneOwner(user: any, scene: any) {
  const email = sceneEmail(user?.email);
  return Boolean(user?.id && email && email === sceneEmail(scene?.client_email));
}

export async function isSceneAdministrator(admin: any, user: any) {
  if (!user?.id) return false;
  const { data } = await admin.from("admin_users").select("user_id, role_label")
    .eq("user_id", user.id).eq("is_active", true).maybeSingle();
  return !!data && !/dessinateur|dessinatrice/.test(String(data.role_label || "").toLowerCase());
}

export async function canManageScene(admin: any, user: any, scene: any) {
  return isSceneOwner(user, scene) || await isSceneAdministrator(admin, user);
}

export async function isSceneCollaborator(admin: any, user: any, sceneId: string) {
  if (!user?.id) return false;
  const { data } = await admin.from("scene_collaborators").select("id")
    .eq("scene_id", sceneId).eq("user_id", user.id).eq("email", sceneEmail(user.email))
    .not("accepted_at", "is", null).maybeSingle();
  return Boolean(data);
}

export async function canDeliverSceneSubmission(admin: any, user: any, scene: any, status: string) {
  if (user?.id && scene.status === status && scene.client_status === "configured") {
    const submittedBy = scene.source_payload?.configuration_submitted_by;
    // Legacy submissions predate attribution; only the main contact may deliver those.
    if (isSceneOwner(user, scene) && (!submittedBy || submittedBy === user.id)) return true;
    if (submittedBy === user.id && await isSceneCollaborator(admin, user, scene.id)) return true;
  }
  return await isSceneAdministrator(admin, user);
}

export async function findSceneInvitation(admin: any, token: unknown) {
  if (typeof token !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token)) return null;
  const { data } = await admin.from("scene_collaborators")
    .select("id, email, user_id, accepted_at, expires_at, code_requested_at, scenes!inner(share_token)")
    .eq("id", token).maybeSingle();
  if (!data || (!data.accepted_at && Date.parse(data.expires_at) <= Date.now())) return null;
  return data;
}
