-- 종 추천 가족당 하루 한도 40 -> 100. 분당 5, 전체 하루 1500은 그대로.
create or replace function public.consume_identify_quota() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  c_per_minute constant int := 5;     -- 가족당 1분
  c_per_day    constant int := 100;   -- 가족당 24시간
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
