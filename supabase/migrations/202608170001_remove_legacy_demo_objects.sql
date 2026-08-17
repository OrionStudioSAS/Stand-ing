-- Remove the first hard-coded demo objects that were used before the real asset library existed.
delete from public.object_bank
where type in ('chair', 'table', 'screen', 'counter');
