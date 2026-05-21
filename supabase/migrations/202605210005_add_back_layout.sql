alter table public.scenes
  drop constraint if exists scenes_layout_check;

alter table public.scenes
  add constraint scenes_layout_check
  check (layout in ('back', 'left', 'right', 'u'));
