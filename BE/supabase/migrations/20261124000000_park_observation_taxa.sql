-- Add taxa from the public Dongtan Lake Park observations to existing deployments.
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1084517', '풀색꽃무지', 'Gametis jucunda', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-11907754', '줄박각시', 'Theretra japonica', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1423350', '아시아실잠자리', 'Ischnura asiatica', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1423395', '북방아시아실잠자리', 'Ischnura elegans', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1423563', '등검은실잠자리', 'Paracercion calamorum', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1423564', '왕실잠자리', 'Paracercion v-nigrum', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-1429229', '밀잠자리붙이', 'Deielia phaon', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-2175367', '산개미거미', 'Myrmarachne formicaria', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-6267489', '버들하늘소', 'Aegosoma sinicum', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-9750846', '꾀꼬리', 'Oriolus chinensis', 'townbird', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-5228280', '파랑새', 'Eurystomus orientalis', 'townbird', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('gbif-2475532', '물총새', 'Alcedo atthis', 'townbird', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-bluegill', '블루길', 'Lepomis macrochirus', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-crucian-carp', '붕어', 'Carassius auratus', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-japanese-crucian-carp', '떡붕어', 'Carassius cuvieri', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-common-carp', '잉어', 'Cyprinus carpio', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-miscanthus-sinensis', '억새', 'Miscanthus sinensis', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, true, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-miscanthus-sacchariflorus', '물억새', 'Miscanthus sacchariflorus', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
insert into public.taxa (id, korean_name, scientific_name, category, confusable_ids, clue, month_counts, photo, photo_license, cultivated, minor) values ('survey-fountain-grass', '수크령', 'Pennisetum alopecuroides', 'other', '{}'::text[], '{"zoneIds":[],"where":"","looks":[]}'::jsonb, null, null, null, false, true)
  on conflict (id) do update set korean_name = excluded.korean_name;
