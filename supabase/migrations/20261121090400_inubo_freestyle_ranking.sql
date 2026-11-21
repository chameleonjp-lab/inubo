-- 実験場と同じ Supabase のイヌボー専用データに、自由操作版の受付を追加する。
-- 既存の版と保存済みの行はそのまま、公開の問い合わせ先と権限も既存のまま使う。
begin;

insert into inubo_ranking_private.versions
  (course_id, course_version, rules_version, min_cs, full_cs, zero_cs, accepting)
values ('park', 'park-5', 'rules-freestyle-3', 4000, 8000, 14667, true)
on conflict (course_id, course_version, rules_version) do nothing;

alter table inubo_ranking_private.runs
  drop constraint runs_trick_score_check,
  drop constraint runs_total_check,
  drop constraint runs_check,
  add constraint runs_trick_score_check check (trick_score >= 0 and (rules_version = 'rules-freestyle-3' or trick_score <= 5000)),
  add constraint runs_total_check check (total >= 0 and (rules_version = 'rules-freestyle-3' or total <= 10000)),
  add constraint runs_check check (
    (record_cs is null and time_score is null and trick_score is null and total is null)
    or (record_cs is not null and time_score is not null and trick_score is not null and total is not null
      and total::bigint = time_score::bigint + trick_score)
  );
alter table inubo_ranking_private.best
  drop constraint best_check,
  add constraint best_check check ((metric = 'total' and order_value between -2147483647 and 0
    and (rules_version = 'rules-freestyle-3' or order_value >= -10000))
    or (metric = 'time' and order_value > 0));

create or replace function inubo_ranking_private.finish(
  p_run_id uuid, p_participant_id uuid, p_course_id text, p_course_version text, p_rules_version text,
  p_dog_id text, p_record_cs integer, p_time_score integer, p_trick_score integer, p_total integer
) returns text language plpgsql security definer set search_path = '' as $$
declare
  existing inubo_ranking_private.runs%rowtype;
  version inubo_ranking_private.versions%rowtype;
  expected_time_score integer;
  span bigint;
  achieved bigint;
begin
  if p_run_id is null or p_participant_id is null then return 'rejected'; end if;
  -- 完走が同時に再送されても、最初に受領した結果だけを残す。
  select * into existing from inubo_ranking_private.runs r where r.run_id = p_run_id for update;
  if not found then return 'unknownStart'; end if;
  if (existing.participant_id, existing.course_id, existing.course_version, existing.rules_version, existing.dog_id)
    is distinct from (p_participant_id, p_course_id, p_course_version, p_rules_version, p_dog_id) then
    return 'rejected';
  end if;
  if existing.record_cs is not null then
    if (existing.record_cs, existing.time_score, existing.trick_score, existing.total)
      is not distinct from (p_record_cs, p_time_score, p_trick_score, p_total) then
      return 'duplicate';
    end if;
    return 'conflict';
  end if;

  select * into version from inubo_ranking_private.versions v
  where (v.course_id, v.course_version, v.rules_version) = (p_course_id, p_course_version, p_rules_version)
    and v.accepting;
  if not found or p_record_cs is null or p_record_cs < version.min_cs
    or p_time_score is null or p_time_score not between 0 and 5000
    or p_trick_score is null or p_trick_score < 0
    or p_total is null or p_total < 0
    or (p_rules_version <> 'rules-freestyle-3' and (p_trick_score > 5000 or p_total > 10000))
    then return 'rejected'; end if;

  span := version.zero_cs::bigint - version.full_cs;
  expected_time_score := case
    when p_record_cs <= version.full_cs then 5000
    when p_record_cs >= version.zero_cs then 0
    else (10000 * (version.zero_cs::bigint - p_record_cs) + span) / (2 * span)
  end;
  if p_time_score <> expected_time_score or p_total::bigint <> expected_time_score::bigint + p_trick_score then return 'rejected'; end if;

  -- 開始から申告タイム分が経つまでは登録を待つ。2秒の通信差を許し、0点タイムを待機の上限にする。
  -- オフライン復帰で開始と完走が続けて届いたときは、同じ内容を後で再送できる。
  if pg_catalog.clock_timestamp() - existing.started_at
    < pg_catalog.make_interval(secs => greatest(least(p_record_cs, version.zero_cs) - 200, 0) / 100.0) then
    return 'tooEarly';
  end if;

  update inubo_ranking_private.runs r
  set record_cs = p_record_cs, time_score = expected_time_score, trick_score = p_trick_score, total = p_total
  where r.run_id = p_run_id;
  achieved := pg_catalog.nextval('inubo_ranking_private.finish_seq'::pg_catalog.regclass);

  insert into inubo_ranking_private.best as b
    (course_id, course_version, rules_version, metric, participant_id, order_value, achieved_seq, display_name, dog_id)
  select p_course_id, p_course_version, p_rules_version, result.metric, p_participant_id,
    result.order_value, achieved, existing.display_name, p_dog_id
  from (values ('time', p_record_cs), ('total', -p_total)) as result(metric, order_value)
  order by result.metric
  on conflict (course_id, course_version, rules_version, metric, participant_id) do update
  set order_value = excluded.order_value, achieved_seq = excluded.achieved_seq,
      display_name = excluded.display_name, dog_id = excluded.dog_id
  where (excluded.order_value, excluded.achieved_seq) < (b.order_value, b.achieved_seq);
  return 'accepted';
end;
$$;

create or replace function inubo_ranking_private.board(
  p_course_id text, p_course_version text, p_rules_version text, p_metric text, p_limit integer
) returns jsonb language sql stable security definer set search_path = '' as $$
  with top as (
    select b.order_value, b.achieved_seq, b.participant_id, b.display_name, b.dog_id
    from inubo_ranking_private.best b
    where (b.course_id, b.course_version, b.rules_version, b.metric) = (p_course_id, p_course_version, p_rules_version, p_metric)
    order by b.order_value, b.achieved_seq, b.participant_id
    limit least(greatest(coalesce(p_limit, 30), 0), 100)
  ), ranked as (
    select rank() over (order by order_value) as rank, top.* from top
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'rank', rank, 'display_name', display_name,
    'value', case when p_metric = 'total' then -order_value else order_value end, 'dog_id', dog_id
  ) order by order_value, achieved_seq, participant_id), '[]'::jsonb)
  from ranked;
$$;

notify pgrst, 'reload schema';
commit;
