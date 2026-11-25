-- 가족 관찰은 100m 격자에서 동일 종을 기록한 가족이 세 가족 이상일 때만 공개합니다.
-- 관찰·사진 원본의 RLS는 그대로 두고, 공개 집계만 Realtime에 전달합니다.

create table public.community_map_cells (
  taxon_id text not null references public.taxa (id) on delete cascade,
  cell_x integer not null,
  cell_y integer not null,
  lat double precision not null,
  lng double precision not null,
  family_count integer not null check (family_count >= 3),
  primary key (taxon_id, cell_x, cell_y)
);
alter table public.community_map_cells enable row level security;
revoke all on public.community_map_cells from public, anon, authenticated;
grant select on public.community_map_cells to anon, authenticated;
create policy "community map readable" on public.community_map_cells for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.community_map_cells;

create function public.community_map_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(c order by c.taxon_id, c.cell_x, c.cell_y), '[]'::jsonb)
  from public.community_map_cells c
$$;
revoke execute on function public.community_map_snapshot() from public;
grant execute on function public.community_map_snapshot() to anon, authenticated;

create function public.community_cell(point extensions.geometry) returns integer[]
language sql immutable strict set search_path = '' as $$
  select array[floor(extensions.st_x(p) / 100)::integer, floor(extensions.st_y(p) / 100)::integer]
  from (select extensions.st_transform(point, 32652) as p) as utm
$$;

create index observations_community_cell_idx
  on public.observations (taxon_id, public.community_cell(subject))
  where not hidden and not outside_park and zone_id is not null and zone_id <> 'Z6'
    and radius_m <= 50 and id_status in ('family', 'reviewed');

create function public.refresh_community_cell(p_taxon text, p_cell integer[]) returns void
language plpgsql set search_path = '' as $$
declare
  families integer;
  center extensions.geometry;
begin
  if p_taxon is null or p_cell is null then return; end if;

  -- 사진 업로드·검토가 겹쳐도 이전 집계가 나중 커밋으로 덮이지 않게 합니다.
  perform pg_advisory_xact_lock(59110425);
  select count(distinct o.household_id)::integer into families
    from public.observations o
    where o.taxon_id = p_taxon and public.community_cell(o.subject) = p_cell
      and not o.hidden and not o.outside_park and o.zone_id is not null and o.zone_id <> 'Z6'
      and o.radius_m <= 50 and o.id_status in ('family', 'reviewed')
      and exists (select 1 from public.photos p where p.observation_id = o.id and not p.hidden);

  if families < 3 then
    delete from public.community_map_cells
      where taxon_id = p_taxon and cell_x = p_cell[1] and cell_y = p_cell[2];
  else
    center := extensions.st_transform(
      extensions.st_setsrid(extensions.st_makepoint(p_cell[1] * 100 + 50, p_cell[2] * 100 + 50), 32652), 4326);
    insert into public.community_map_cells (taxon_id, cell_x, cell_y, lat, lng, family_count)
    values (p_taxon, p_cell[1], p_cell[2], extensions.st_y(center), extensions.st_x(center), families)
    on conflict (taxon_id, cell_x, cell_y) do update set family_count = excluded.family_count
      where community_map_cells.family_count <> excluded.family_count;
  end if;
end $$;

create function public.refresh_community_observation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_cell integer[];
  new_cell integer[];
begin
  if old.taxon_id is not null and not old.hidden and not old.outside_park and old.zone_id <> 'Z6'
    and old.radius_m <= 50 and old.id_status in ('family', 'reviewed') then
    old_cell := public.community_cell(old.subject);
    perform public.refresh_community_cell(old.taxon_id, old_cell);
  end if;
  if tg_op = 'UPDATE' and new.taxon_id is not null and not new.hidden and not new.outside_park and new.zone_id <> 'Z6'
    and new.radius_m <= 50 and new.id_status in ('family', 'reviewed') then
    new_cell := public.community_cell(new.subject);
    if (new.taxon_id, new_cell) is distinct from (old.taxon_id, old_cell) then
      perform public.refresh_community_cell(new.taxon_id, new_cell);
    end if;
  end if;
  return null;
end $$;

create function public.refresh_community_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_id uuid;
  new_id uuid;
  obs record;
begin
  if tg_op <> 'INSERT' then old_id := old.observation_id; end if;
  if tg_op <> 'DELETE' then new_id := new.observation_id; end if;
  perform pg_advisory_xact_lock(59110425);
  for obs in
    select taxon_id, public.community_cell(subject) as cell from public.observations
      where id in (old_id, new_id) and not hidden and not outside_park and zone_id is not null and zone_id <> 'Z6'
        and radius_m <= 50 and id_status in ('family', 'reviewed')
  loop
    perform public.refresh_community_cell(obs.taxon_id, obs.cell);
  end loop;
  return null;
end $$;

create trigger observations_community_map
  after update or delete on public.observations
  for each row execute function public.refresh_community_observation();
create trigger photos_community_map
  after insert or update of hidden, observation_id or delete on public.photos
  for each row execute function public.refresh_community_photo();

revoke execute on function public.community_cell(extensions.geometry) from public, anon, authenticated;
revoke execute on function public.refresh_community_cell(text, integer[]) from public, anon, authenticated;
revoke execute on function public.refresh_community_observation() from public, anon, authenticated;
revoke execute on function public.refresh_community_photo() from public, anon, authenticated;

-- 서버에 이미 모인 사진 기록도 같은 기준으로 집계합니다.
select public.refresh_community_cell(taxon_id, cell)
from (
  select distinct o.taxon_id, public.community_cell(o.subject) as cell
  from public.observations o
  where o.taxon_id is not null and not o.hidden and not o.outside_park and o.zone_id is not null and o.zone_id <> 'Z6'
    and o.radius_m <= 50 and o.id_status in ('family', 'reviewed')
    and exists (select 1 from public.photos p where p.observation_id = o.id and not p.hidden)
) as existing;
