-- 우리 공원 생명 도감 — 초기 스키마 (PRD v0.2, 6·8장)
-- 가족은 기기 익명 계정(auth.users, is_anonymous), 팀 검토자는 app_metadata.role = 'reviewer'.
-- 쓰기는 모두 security definer 함수로만 하고, 읽기는 행 단위 권한(RLS)으로 막습니다.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------
-- 콘텐츠(시드: supabase/seed.sql ← npm run seed:sql)
-- ---------------------------------------------------------------
create table public.zones (
  id text primary key check (id ~ '^Z[0-9]+$'),
  name text not null,
  description text,
  priority smallint not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  placeholder boolean not null default false
);
create index zones_geom_idx on public.zones using gist (geom);

create table public.biotopes (
  id bigint generated always as identity primary key,
  code text not null,
  name text,
  year smallint not null default 2024,
  source text not null default '경기기후플랫폼 비오톱',
  geom extensions.geometry(MultiPolygon, 4326) not null,
  placeholder boolean not null default false
);
create index biotopes_geom_idx on public.biotopes using gist (geom);

create table public.taxa (
  id text primary key,
  korean_name text not null,
  scientific_name text,
  category text check (category in ('waterbird', 'townbird', 'tree', 'other')),
  confusable_ids text[] not null default '{}',
  clue jsonb,
  month_counts integer[],
  photo jsonb,
  photo_license text,
  cultivated boolean not null default false,
  minor boolean not null default false
);

create table public.season_sets (
  id text primary key,
  season text not null,
  label text,
  starts_on date not null,
  ends_on date not null,
  today_six text[] not null,
  dex text[] not null
);

-- ---------------------------------------------------------------
-- 가족·탐험·기록
-- ---------------------------------------------------------------
create type public.id_status as enum ('unidentified', 'family', 'reviewed', 'undeterminable');

-- 가족(기기 익명 계정). 이름·연락처·아이 정보는 두지 않습니다.
-- 기록 지키기로 연결한 이메일은 auth.users.email에만 있습니다.
create table public.households (
  id uuid primary key references auth.users (id) on delete cascade,
  anon_no integer generated always as identity unique,
  created_at timestamptz not null default now(),
  consent_version text,
  consented_at timestamptz,
  default_adults smallint check (default_adults between 0 and 20),
  default_children smallint check (default_children between 0 and 20)
);

create table public.walks (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  ended_by text check (ended_by in ('manual', 'auto')),
  last_activity_at timestamptz not null,
  adults smallint check (adults between 0 and 20),
  children smallint check (children between 0 and 20),
  zone_ids text[] not null default '{}',
  effort_text text,
  created_at timestamptz not null default now()
);
create index walks_household_idx on public.walks (household_id);
create index walks_open_idx on public.walks (last_activity_at) where ended_at is null;

create table public.observations (
  id uuid primary key, -- occurrenceID(기기에서 만든 UUID)
  household_id uuid not null references public.households (id) on delete cascade,
  walk_id uuid not null references public.walks (id) on delete cascade,
  observed_at timestamptz not null,
  observed_at_source text not null check (observed_at_source in ('exif', 'device')),
  client_created_at timestamptz not null,
  found_at timestamptz,
  created_at timestamptz not null default now(),
  family_taxon_id text references public.taxa (id),
  free_text_name text check (char_length(free_text_name) <= 60),
  pick_source text not null check (pick_source in ('card', 'zone', 'search', 'free_text', 'unknown')),
  candidate_ids text[] not null default '{}',
  taxon_id text references public.taxa (id),
  id_status public.id_status not null,
  subject_lat double precision not null check (subject_lat between -90 and 90),
  subject_lng double precision not null check (subject_lng between -180 and 180),
  subject extensions.geometry(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(subject_lng, subject_lat), 4326)) stored,
  radius_m integer not null check (radius_m between 1 and 5000),
  location_method text not null check (location_method in ('tap', 'near_me')),
  distance_m real,
  observer_lat double precision,
  observer_lng double precision,
  observer_accuracy_m real,
  zone_id text references public.zones (id),
  biotope_code text,
  biotope_name text,
  biotope_year smallint,
  biotope_source text,
  outside_park boolean not null default false,
  establishment_means text,
  duplicate_group_id uuid,
  hidden boolean not null default false,
  hidden_reason text,
  date_identified timestamptz,
  identification_remarks text
);
create index observations_household_idx on public.observations (household_id);
create index observations_walk_idx on public.observations (walk_id);
create index observations_observed_idx on public.observations (observed_at);
create index observations_subject_idx on public.observations using gist (subject);

create table public.photos (
  id uuid primary key,
  observation_id uuid not null references public.observations (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  original_path text not null,
  display_path text,
  mime text not null,
  exif_time timestamptz,
  media_source text not null check (media_source in ('camera', 'album')),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index photos_observation_idx on public.photos (observation_id);

-- 동정 이력: 누가, 언제, 이전 값, 사유
create table public.identifications (
  id bigint generated always as identity primary key,
  observation_id uuid not null references public.observations (id) on delete cascade,
  taxon_id text references public.taxa (id),
  status public.id_status not null,
  actor text not null check (actor in ('household', 'reviewer')),
  actor_id uuid,
  reason text,
  previous_taxon_id text references public.taxa (id),
  previous_status public.id_status,
  created_at timestamptz not null default now()
);
create index identifications_observation_idx on public.identifications (observation_id);

-- 사용 기록(화면 진입·기록 단계 시각, 익명 가족 단위). 동의 뒤에만 기기에서 보냅니다.
create table public.usage_events (
  id bigint generated always as identity primary key,
  household_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 40),
  at timestamptz not null,
  props jsonb not null default '{}',
  received_at timestamptz not null default now()
);

create table public.deletion_requests (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  requested_at timestamptz not null default now(),
  reason text check (char_length(reason) <= 200),
  status text not null default 'requested' check (status in ('requested', 'done', 'rejected'))
);

-- ---------------------------------------------------------------
-- 도움 함수
-- ---------------------------------------------------------------
create or replace function public.is_reviewer() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'reviewer', false)
$$;

-- 그림 지도 네 모서리(public/content/v1.json의 park.bounds와 같아야 함)
create or replace function public.park_bounds() returns extensions.geometry
language sql immutable as $$
  select extensions.st_makeenvelope(127.09493, 37.16293, 127.10693, 37.17447, 4326)
$$;

-- 비오톱 조회 범위. 밖은 ‘범위 밖’(지도값 없음)
create or replace function public.biotope_query_bounds() returns extensions.geometry
language sql immutable as $$
  select extensions.st_makeenvelope(127.095, 37.165, 127.110, 37.176, 4326)
$$;

-- 조사 노력 문구. src/lib/effort.ts와 같은 형식: "어른 1·아이 2 × 40분, Z1·Z4"
create or replace function public.walk_effort_text(p_adults integer, p_children integer, p_minutes integer, p_zone_ids text[])
returns text language sql immutable as $$
  select case when p_adults is null and p_children is null then '인원 미입력'
              else format('어른 %s·아이 %s', coalesce(p_adults, 0), coalesce(p_children, 0)) end
         || format(' × %s분', p_minutes)
         || case when coalesce(array_length(p_zone_ids, 1), 0) > 0 then ', ' || array_to_string(p_zone_ids, '·') else '' end
$$;

create or replace function public.require_consent(p_uid uuid) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from households where id = p_uid and consented_at is not null) then
    raise exception 'consent_required';
  end if;
end $$;

-- 탐험이 끝났으면 기록이 나온 구역과 조사 노력을 다시 계산합니다(늦게 도착한 기록 포함).
create or replace function public.finalize_walk(p_walk_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  w walks;
  v_zones text[];
begin
  select * into w from walks where id = p_walk_id;
  if w.ended_at is null then return; end if;
  select coalesce(array_agg(distinct zone_id order by zone_id), '{}') into v_zones
    from observations where walk_id = p_walk_id and zone_id is not null;
  update walks
     set zone_ids = v_zones,
         effort_text = walk_effort_text(w.adults, w.children,
           greatest(0, round(extract(epoch from (w.ended_at - w.started_at)) / 60))::integer, v_zones)
   where id = p_walk_id;
end $$;

-- ---------------------------------------------------------------
-- 가족이 부르는 함수
-- ---------------------------------------------------------------
create or replace function public.register_consent(p_version text, p_consented_at timestamptz, p_adults integer, p_children integer)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into households (id, consent_version, consented_at, default_adults, default_children)
  values (uid, p_version, coalesce(p_consented_at, now()), p_adults, p_children)
  on conflict (id) do update
    set consent_version = excluded.consent_version,
        consented_at = excluded.consented_at,
        default_adults = excluded.default_adults,
        default_children = excluded.default_children;
end $$;

create or replace function public.start_walk(p_id uuid, p_started_at timestamptz, p_adults integer, p_children integer)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid();
begin
  perform require_consent(uid);
  insert into walks (id, household_id, started_at, last_activity_at, adults, children)
  values (p_id, uid, p_started_at, p_started_at, p_adults, p_children)
  on conflict (id) do nothing;
  if not exists (select 1 from walks where id = p_id and household_id = uid) then
    raise exception 'forbidden';
  end if;
end $$;

create or replace function public.end_walk(p_id uuid, p_ended_at timestamptz, p_ended_by text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid();
begin
  perform require_consent(uid);
  update walks
     set ended_at = least(greatest(p_ended_at, started_at), started_at + interval '3 hours'),
         ended_by = case when p_ended_by in ('manual', 'auto') then p_ended_by else 'manual' end
   where id = p_id and household_id = uid;
  if not found then raise exception 'forbidden'; end if;
  perform finalize_walk(p_id);
end $$;

-- occurrenceID 기준 멱등 저장. 같은 기록을 두 번 보내도 한 건만 남습니다.
-- 구역·비오톱·공원 밖 여부는 여기서 생물 위치로 계산합니다.
create or replace function public.upsert_observation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  v_id uuid := (p ->> 'id')::uuid;
  v_walk uuid := (p -> 'walk' ->> 'id')::uuid;
  v_walk_start timestamptz := (p -> 'walk' ->> 'startedAt')::timestamptz;
  v_lat double precision := (p ->> 'subjectLat')::double precision;
  v_lng double precision := (p ->> 'subjectLng')::double precision;
  v_obs_lat double precision := (p ->> 'observerLat')::double precision;
  v_obs_lng double precision := (p ->> 'observerLng')::double precision;
  v_status id_status := (p ->> 'idStatus')::id_status;
  v_family_taxon text := nullif(p ->> 'familyTaxonId', '');
  v_remarks text;
  v_point geometry;
  v_zone text;
  v_bio_code text;
  v_bio_name text;
  v_bio_year smallint;
  v_bio_source text;
  v_outside boolean;
  v_client_created timestamptz := (p ->> 'clientCreatedAt')::timestamptz;
begin
  perform require_consent(uid);

  if exists (select 1 from observations where id = v_id) then
    if not exists (select 1 from observations where id = v_id and household_id = uid) then
      raise exception 'forbidden';
    end if;
    return (select jsonb_build_object('zoneId', zone_id, 'biotopeCode', biotope_code, 'outsidePark', outside_park)
              from observations where id = v_id);
  end if;

  -- 익명 계정당 분당 20건
  if (select count(*) from observations where household_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate_limited';
  end if;

  if v_status not in ('unidentified', 'family') then raise exception 'invalid_status'; end if;
  -- 콘텐츠와 시드가 어긋나도 기록은 잃지 않습니다.
  if v_family_taxon is not null and not exists (select 1 from taxa where id = v_family_taxon) then
    v_remarks := '알 수 없는 종 id: ' || v_family_taxon;
    v_family_taxon := null;
    v_status := 'unidentified';
  end if;

  insert into walks (id, household_id, started_at, last_activity_at, adults, children)
  values (v_walk, uid, v_walk_start, v_walk_start, (p -> 'walk' ->> 'adults')::integer, (p -> 'walk' ->> 'children')::integer)
  on conflict (id) do nothing;
  if not exists (select 1 from walks where id = v_walk and household_id = uid) then
    raise exception 'forbidden';
  end if;

  v_point := st_setsrid(st_makepoint(v_lng, v_lat), 4326);
  select id into v_zone from zones where st_intersects(geom, v_point) order by priority limit 1;
  if st_intersects(biotope_query_bounds(), v_point) then
    select code, name, year, source into v_bio_code, v_bio_name, v_bio_year, v_bio_source
      from biotopes where st_intersects(geom, v_point) order by st_area(geom) limit 1;
  end if;
  v_outside := not st_intersects(park_bounds(), v_point)
    or (v_obs_lat is not null and v_obs_lng is not null
        and not st_intersects(park_bounds(), st_setsrid(st_makepoint(v_obs_lng, v_obs_lat), 4326)));

  insert into observations (
    id, household_id, walk_id, observed_at, observed_at_source, client_created_at, found_at,
    family_taxon_id, free_text_name, pick_source, candidate_ids, taxon_id, id_status,
    subject_lat, subject_lng, radius_m, location_method, distance_m,
    observer_lat, observer_lng, observer_accuracy_m,
    zone_id, biotope_code, biotope_name, biotope_year, biotope_source, outside_park, identification_remarks
  ) values (
    v_id, uid, v_walk, (p ->> 'observedAt')::timestamptz, p ->> 'observedAtSource', v_client_created,
    (p ->> 'foundAt')::timestamptz,
    v_family_taxon, nullif(left(p ->> 'freeTextName', 60), ''), p ->> 'pickSource',
    coalesce(array(select jsonb_array_elements_text(p -> 'candidateIds')), '{}'),
    v_family_taxon, v_status,
    v_lat, v_lng, (p ->> 'radiusM')::integer, p ->> 'locationMethod', (p ->> 'distanceM')::real,
    v_obs_lat, v_obs_lng, (p ->> 'observerAccuracyM')::real,
    v_zone, v_bio_code, v_bio_name, v_bio_year, v_bio_source, v_outside, v_remarks
  );

  insert into identifications (observation_id, taxon_id, status, actor, actor_id)
  values (v_id, v_family_taxon, v_status, 'household', uid);

  update walks set last_activity_at = greatest(last_activity_at, v_client_created) where id = v_walk;
  perform finalize_walk(v_walk);

  return jsonb_build_object('zoneId', v_zone, 'biotopeCode', v_bio_code, 'outsidePark', v_outside);
end $$;

-- 사진은 저장소에 올린 뒤 등록합니다(경로 첫 폴더 = 가족 계정 id).
create or replace function public.register_photo(
  p_id uuid, p_observation_id uuid, p_original_path text, p_display_path text,
  p_mime text, p_exif_time timestamptz, p_media_source text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid();
begin
  perform require_consent(uid);
  if not exists (select 1 from observations where id = p_observation_id and household_id = uid) then
    raise exception 'forbidden';
  end if;
  if split_part(p_original_path, '/', 1) <> uid::text
     or (p_display_path is not null and split_part(p_display_path, '/', 1) <> uid::text) then
    raise exception 'forbidden_path';
  end if;
  if not exists (select 1 from photos where id = p_id)
     and (select count(*) from photos where observation_id = p_observation_id) >= 3 then
    raise exception 'too_many_photos';
  end if;
  insert into photos (id, observation_id, household_id, original_path, display_path, mime, exif_time, media_source)
  values (p_id, p_observation_id, uid, p_original_path, p_display_path, p_mime, p_exif_time, p_media_source)
  on conflict (id) do nothing;
end $$;

create or replace function public.request_deletion(p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid();
begin
  perform require_consent(uid);
  insert into deletion_requests (household_id, reason) values (uid, left(p_reason, 200));
end $$;

-- 30분 동안 활동이 없거나 3시간이 지난 탐험을 자동으로 끝냅니다(pg_cron, 다음 마이그레이션).
create or replace function public.close_idle_walks() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  w record;
  n integer := 0;
begin
  for w in
    select id, started_at, last_activity_at from walks
     where ended_at is null
       and (last_activity_at < now() - interval '30 minutes' or started_at < now() - interval '3 hours')
  loop
    update walks
       set ended_at = least(w.last_activity_at, w.started_at + interval '3 hours'), ended_by = 'auto'
     where id = w.id;
    perform finalize_walk(w.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------
-- 팀 검토자가 부르는 함수
-- ---------------------------------------------------------------
-- p_changes 키: taxon_id, status, reason, hidden, hidden_reason, establishment_means, duplicate_group_id
create or replace function public.review_observation(p_id uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  o observations;
  v_taxon text;
  v_status id_status;
begin
  if not is_reviewer() then raise exception 'forbidden'; end if;
  select * into o from observations where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  if p_changes ? 'taxon_id' or p_changes ? 'status' then
    v_taxon := case when p_changes ? 'taxon_id' then nullif(p_changes ->> 'taxon_id', '') else o.taxon_id end;
    v_status := coalesce((p_changes ->> 'status')::id_status, o.id_status);
    insert into identifications (observation_id, taxon_id, status, actor, actor_id, reason, previous_taxon_id, previous_status)
    values (p_id, v_taxon, v_status, 'reviewer', auth.uid(), nullif(p_changes ->> 'reason', ''), o.taxon_id, o.id_status);
    update observations
       set taxon_id = v_taxon,
           id_status = v_status,
           date_identified = now(),
           identification_remarks = coalesce(nullif(p_changes ->> 'reason', ''), identification_remarks)
     where id = p_id;
  end if;

  if p_changes ? 'hidden' then
    update observations
       set hidden = (p_changes ->> 'hidden')::boolean,
           hidden_reason = case when (p_changes ->> 'hidden')::boolean then nullif(p_changes ->> 'hidden_reason', '') end
     where id = p_id;
  end if;
  if p_changes ? 'establishment_means' then
    update observations set establishment_means = nullif(p_changes ->> 'establishment_means', '') where id = p_id;
  end if;
  if p_changes ? 'duplicate_group_id' then
    update observations set duplicate_group_id = nullif(p_changes ->> 'duplicate_group_id', '')::uuid where id = p_id;
  end if;
end $$;

create or replace function public.review_set_photo_hidden(p_photo_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_reviewer() then raise exception 'forbidden'; end if;
  update photos set hidden = p_hidden where id = p_photo_id;
end $$;

-- 같은 개체로 묶기. 이미 묶음이 있으면 그 묶음으로 합칩니다.
create or replace function public.group_duplicates(p_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare g uuid;
begin
  if not is_reviewer() then raise exception 'forbidden'; end if;
  select duplicate_group_id into g from observations
   where id = any (p_ids) and duplicate_group_id is not null limit 1;
  g := coalesce(g, gen_random_uuid());
  update observations set duplicate_group_id = g where id = any (p_ids);
  return g;
end $$;

-- ---------------------------------------------------------------
-- 뷰(호출한 사람의 권한과 RLS를 따름)
-- ---------------------------------------------------------------
create view public.observation_details with (security_invoker = true) as
select
  o.id, o.walk_id, o.observed_at,
  (o.observed_at at time zone 'Asia/Seoul')::date as observed_date,
  h.anon_no as household_no,
  t.korean_name as vernacular_name, t.scientific_name,
  ft.korean_name as family_vernacular_name,
  o.free_text_name, o.id_status,
  o.subject_lat, o.subject_lng, o.radius_m, o.location_method, o.distance_m,
  o.observer_lat, o.observer_lng, o.observer_accuracy_m,
  o.zone_id, z.name as zone_name, o.outside_park,
  o.biotope_code, o.biotope_name, o.biotope_year, o.biotope_source,
  w.effort_text, o.establishment_means, o.date_identified, o.identification_remarks, o.duplicate_group_id,
  coalesce((select array_agg(p.original_path order by p.created_at)
              from photos p where p.observation_id = o.id and not p.hidden), '{}') as photo_paths,
  o.hidden, o.taxon_id, o.family_taxon_id, o.candidate_ids, o.pick_source,
  o.created_at, o.client_created_at, o.found_at, o.hidden_reason, o.household_id
from observations o
join households h on h.id = o.household_id
join walks w on w.id = o.walk_id
left join taxa t on t.id = o.taxon_id
left join taxa ft on ft.id = o.family_taxon_id
left join zones z on z.id = o.zone_id;

create view public.identification_history with (security_invoker = true) as
select
  i.observation_id, i.created_at, i.actor,
  t.korean_name as vernacular_name, t.scientific_name, i.status,
  pt.korean_name as previous_vernacular_name, i.previous_status, i.reason,
  (o.observed_at at time zone 'Asia/Seoul')::date as observed_date,
  o.id_status as current_status, o.hidden
from identifications i
join observations o on o.id = i.observation_id
left join taxa t on t.id = i.taxon_id
left join taxa pt on pt.id = i.previous_taxon_id;

-- 중복 후보: 같은 종 · 생물 위치 30m 안 · 10분 안
create or replace function public.duplicate_candidates(p_id uuid) returns setof public.observation_details
language sql stable set search_path = public, extensions as $$
  select d.* from observation_details d
  join observations o on o.id = p_id
  where is_reviewer()
    and d.id <> p_id
    and d.taxon_id = o.taxon_id
    and abs(extract(epoch from (d.observed_at - o.observed_at))) <= 600
    and st_dwithin(st_setsrid(st_makepoint(d.subject_lng, d.subject_lat), 4326)::geography, o.subject::geography, 30)
$$;

-- ---------------------------------------------------------------
-- 행 단위 권한: 가족은 자기 기록만, 팀은 전체
-- ---------------------------------------------------------------
alter table public.zones enable row level security;
alter table public.biotopes enable row level security;
alter table public.taxa enable row level security;
alter table public.season_sets enable row level security;
alter table public.households enable row level security;
alter table public.walks enable row level security;
alter table public.observations enable row level security;
alter table public.photos enable row level security;
alter table public.identifications enable row level security;
alter table public.usage_events enable row level security;
alter table public.deletion_requests enable row level security;

create policy "content readable" on public.zones for select using (true);
create policy "content readable" on public.biotopes for select using (true);
create policy "content readable" on public.taxa for select using (true);
create policy "content readable" on public.season_sets for select using (true);

create policy "own or reviewer" on public.households for select using (id = auth.uid() or public.is_reviewer());
create policy "own or reviewer" on public.walks for select using (household_id = auth.uid() or public.is_reviewer());
create policy "own or reviewer" on public.observations for select using (household_id = auth.uid() or public.is_reviewer());
create policy "own or reviewer" on public.photos for select using (household_id = auth.uid() or public.is_reviewer());
create policy "own or reviewer" on public.identifications for select using (
  public.is_reviewer() or exists (select 1 from public.observations o where o.id = observation_id and o.household_id = auth.uid())
);
create policy "own or reviewer" on public.deletion_requests for select using (household_id = auth.uid() or public.is_reviewer());
create policy "insert own events" on public.usage_events for insert to authenticated with check (household_id = auth.uid());
create policy "reviewer reads events" on public.usage_events for select using (public.is_reviewer());

-- 내부용 함수는 바깥에서 부르지 못하게 합니다.
revoke execute on function public.require_consent(uuid) from public, anon, authenticated;
revoke execute on function public.finalize_walk(uuid) from public, anon, authenticated;
revoke execute on function public.close_idle_walks() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 사진 저장소: 비공개 버킷, 서명 URL로만 올리고 봅니다(10분 만료는 앱에서 지정).
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 26214400, array['image/*'])
on conflict (id) do nothing;

create policy "family uploads own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "family reads own photos, reviewer reads all" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_reviewer()));
