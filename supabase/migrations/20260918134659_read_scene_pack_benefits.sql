-- Exhibitors may read their own pack settings, not other salons' packs or admin data.
drop policy if exists "exhibitor read own scene pack" on public.salon_offers;
create policy "exhibitor read own scene pack"
on public.salon_offers for select to authenticated
using (
  (select private.current_email()) <> ''
  and exists (
    select 1 from public.scenes s
    where s.offer_id = salon_offers.id
      and lower(s.client_email) = (select private.current_email())
  )
);
