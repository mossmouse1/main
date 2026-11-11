-- 사진 종 추천(AI) 호출 기록과 한도, pick_source에 'photo_ai' 추가.

create table public.identify_calls (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index identify_calls_household_created on public.identify_calls (household_id, created_at desc);
create index identify_calls_created on public.identify_calls (created_at desc);
-- 정책 없음: 아래 함수(security definer)로만 접근합니다.
alter table public.identify_calls enable row level security;

create or replace function public.consume_identify_quota() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  c_per_minute constant int := 5;     -- 가족당 1분
  c_per_day    constant int := 40;    -- 가족당 24시간
  c_global_day constant int := 1500;  -- 전체 가족 24시간
  uid uuid := auth.uid();
begin
  perform public.require_consent(uid); -- not_authenticated / consent_required
  if (select count(*) from identify_calls where household_id = uid and created_at > now() - interval '1 minute') >= c_per_minute then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from identify_calls where household_id = uid and created_at > now() - interval '24 hours') >= c_per_day then
    raise exception 'daily_limit';
  end if;
  if (select count(*) from identify_calls where created_at > now() - interval '24 hours') >= c_global_day then
    raise exception 'global_limit';
  end if;
  insert into identify_calls (household_id) values (uid);
end $$;

revoke execute on function public.consume_identify_quota() from public, anon;
grant execute on function public.consume_identify_quota() to authenticated;

alter table public.observations drop constraint observations_pick_source_check;
alter table public.observations add constraint observations_pick_source_check
  check (pick_source in ('card', 'zone', 'search', 'free_text', 'unknown', 'photo_ai'));
