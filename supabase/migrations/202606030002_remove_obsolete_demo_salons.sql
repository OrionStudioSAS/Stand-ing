-- Retire les anciennes scenes de demo hors SMCL du configurateur et de l'admin.
delete from public.scene_items
where scene_id in ('demo-salon-a', 'demo-salon-b');

delete from public.scene_files
where scene_id in ('demo-salon-a', 'demo-salon-b');

delete from public.scenes
where id in ('demo-salon-a', 'demo-salon-b')
   or lower(salon) in ('salon golf', 'salon habitat')
   or lower(event_name) in ('salon golf', 'salon habitat')
   or lower(client_email) in ('golf@example.com', 'habitat@example.com');
