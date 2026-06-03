insert into public.scenes (
  id, share_token, monday_item_id, salon, offer, status, client_status,
  client_name, client_email, project_name, event_name, width_m, depth_m, height_m, layout
)
values
  ('smcl-confort-demo', 'smcl-confort-demo', 'SMCL-CONFORT-001', 'SMCL', 'Confort', 'created', 'not_started', 'Collectivite Demo', 'client-smcl@example.com', 'Stand SMCL Confort', 'SMCL', 4, 3, 2.5, 'u'),
  ('smcl-prestige-demo', 'smcl-prestige-demo', 'SMCL-PRESTIGE-001', 'SMCL', 'Prestige', 'created', 'draft', 'Mairie Exemple', 'prestige-smcl@example.com', 'Stand SMCL Prestige', 'SMCL', 6, 3, 2.8, 'right')
on conflict (id) do update set
  share_token = excluded.share_token,
  monday_item_id = excluded.monday_item_id,
  salon = excluded.salon,
  offer = excluded.offer,
  status = excluded.status,
  client_status = excluded.client_status,
  client_name = excluded.client_name,
  client_email = excluded.client_email,
  project_name = excluded.project_name,
  event_name = excluded.event_name,
  width_m = excluded.width_m,
  depth_m = excluded.depth_m,
  height_m = excluded.height_m,
  layout = excluded.layout,
  updated_at = now();

delete from public.scene_items where scene_id in ('smcl-confort-demo', 'smcl-prestige-demo');

insert into public.scene_items (scene_id, item_uid, type, x, y, z, rotation, wall, config)
values
  ('smcl-confort-demo', 'table-1', 'table', -0.75, 0, 0.3, 0, null, '{"id":"table-1","type":"table","x":-0.75,"z":0.3,"y":0,"rotation":0}'::jsonb),
  ('smcl-confort-demo', 'chair-1', 'chair', 0.8, 0, 0.45, -15, null, '{"id":"chair-1","type":"chair","x":0.8,"z":0.45,"y":0,"rotation":-15}'::jsonb),
  ('smcl-confort-demo', 'screen-1', 'screen', 0, 1.65, -1.5, 0, 'back', '{"id":"screen-1","type":"screen","x":0,"z":-1.5,"y":1.65,"wall":"back","rotation":0}'::jsonb),
  ('smcl-prestige-demo', 'table-1', 'table', -0.8, 0, 0.4, 0, null, '{"id":"table-1","type":"table","x":-0.8,"z":0.4,"y":0,"rotation":0}'::jsonb),
  ('smcl-prestige-demo', 'screen-1', 'screen', 0.2, 1.65, -1.5, 0, 'back', '{"id":"screen-1","type":"screen","x":0.2,"z":-1.5,"y":1.65,"wall":"back","rotation":0}'::jsonb),
  ('smcl-prestige-demo', 'counter-1', 'counter', 1.2, 0, 0.9, 15, null, '{"id":"counter-1","type":"counter","x":1.2,"z":0.9,"y":0,"rotation":15}'::jsonb);
