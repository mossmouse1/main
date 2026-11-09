-- 30분 무활동 탐험 자동 종료를 5분마다 돌립니다.
-- Supabase에서 pg_cron 확장을 켤 수 있어야 합니다(대시보드 Database → Extensions).
create extension if not exists pg_cron;

select cron.schedule('close-idle-walks', '*/5 * * * *', $$select public.close_idle_walks()$$);
