-- Keep color IDs and ordering stable so saved scenes keep resolving their choice.
-- 0851 is Pacific Blue in the manufacturer's Rewind Flat chart (Bleu Europe).
update public.object_bank
set dimensions = jsonb_set(
  jsonb_set(dimensions, '{colorOptions}', (
    select jsonb_agg(case when color->>'code' = '0809'
      then color || jsonb_build_object('code', '0851', 'name', 'Bleu Europe', 'hex', '#06467e', 'image', 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22128%22%20height%3D%22128%22%20viewBox%3D%220%200%20128%20128%22%3E%0A%20%20%3Cdefs%3E%0A%20%20%20%20%3Cfilter%20id%3D%22grain%22%3E%3CfeTurbulence%20type%3D%22fractalNoise%22%20baseFrequency%3D%22.8%22%20numOctaves%3D%222%22%20stitchTiles%3D%22stitch%22%2F%3E%3CfeColorMatrix%20type%3D%22saturate%22%20values%3D%220%22%2F%3E%3CfeComponentTransfer%3E%3CfeFuncA%20type%3D%22linear%22%20slope%3D%22.06%22%2F%3E%3C%2FfeComponentTransfer%3E%3C%2Ffilter%3E%0A%20%20%3C%2Fdefs%3E%0A%20%20%3Cpath%20fill%3D%22%2306467e%22%20d%3D%22M0%200h128v128H0z%22%2F%3E%0A%20%20%3Cpath%20filter%3D%22url%28%23grain%29%22%20d%3D%22M0%200h128v128H0z%22%2F%3E%0A%3C%2Fsvg%3E%0A', 'storagePath', '',
        'swatchSource', 'https://www.rewindcarpet.com/de/event/collections/flat-collection')
      else color end order by position)
    from jsonb_array_elements(dimensions->'colorOptions') with ordinality as colors(color, position)
  )),
  '{colorGroupReference}',
  case when dimensions->>'colorGroupReference' like 'SMCL%' then '""'::jsonb
    else coalesce(dimensions->'colorGroupReference', '""'::jsonb) end
)
where dimensions->>'isColorGroup' = 'true'
  and dimensions->'packs' = '["Équipé"]'::jsonb
  and dimensions->'colorUsages' ? 'carpet';
