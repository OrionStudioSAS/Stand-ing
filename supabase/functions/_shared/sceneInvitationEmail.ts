const invitationHtmlEntities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

function escapeInvitationHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => invitationHtmlEntities[character]);
}

export async function sendSceneInvitationLink(admin: any, invitation: { id: string; email: string }, scene: any, language: unknown) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Invitation mail provider is not configured");
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: invitation.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error("Could not generate invitation sign-in link");

  const english = language === "en";
  const url = new URL(Deno.env.get("PUBLIC_APP_URL") || "https://configurateur3d.stand-ing.com/");
  url.searchParams.set("invite", invitation.id);
  url.searchParams.set("access", "link");
  if (english) url.searchParams.set("lang", "en");
  // Keep the one-time credential out of request URLs and referrers.
  url.hash = new URLSearchParams({ invitation_auth: tokenHash }).toString();

  const stand = scene.project_name || scene.event_name || scene.salon || "Stand-ING";
  const intro = english ? `You’re invited to collaborate on the stand “${stand}”.` : `Vous êtes invité à collaborer sur le stand « ${stand} ».`;
  const button = english ? "Open the stand" : "Ouvrir la scène";
  const fallback = english ? "If the button doesn’t work, open this link:" : "Si le bouton ne fonctionne pas, ouvrez ce lien :";
  const link = escapeInvitationHtml(url.toString());
  const html = `<div style="font-family:Arial,sans-serif;color:#18243a;line-height:1.55">
    <p>${escapeInvitationHtml(intro)}</p>
    <p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:7px;background:#1f4378;color:#fff;text-decoration:none;font-weight:700">${button}</a></p>
    <p>${fallback}<br><a href="${link}" style="color:#1f4378;word-break:break-all">${link}</a></p>
    <p>Stand-ING</p>
  </div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "Stand-ING <no-reply@stand-ing.com>",
      to: [invitation.email],
      subject: english ? "Invitation to collaborate on a Stand-ING stand" : "Invitation à collaborer sur un stand Stand-ING",
      text: `${intro}\n\n${button} : ${url}\n\nStand-ING`,
      html,
    }),
  });
  if (!response.ok) throw new Error(`Email provider: ${response.status}`);
}
