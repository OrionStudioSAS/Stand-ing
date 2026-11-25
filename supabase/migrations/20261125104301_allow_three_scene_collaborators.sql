alter table public.scene_collaborators
  drop constraint scene_collaborators_slot_check,
  add constraint scene_collaborators_slot_check check (slot between 1 and 3);
