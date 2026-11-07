-- 犬スケ専用。実験場のランキング、設定、データは変更しない。
-- Data API は public の3関数だけを使う。inubo_ranking_private は公開対象に追加しない。
begin;

create schema inubo_ranking_private;
revoke all on schema inubo_ranking_private from public, anon, authenticated, service_role;

-- これらの関数だけに、専用テーブルの操作権限を持たせる。
create role inubo_ranking_executor nologin noinherit;
grant inubo_ranking_executor to current_user with set true;
grant usage, create on schema inubo_ranking_private to inubo_ranking_executor;

create table inubo_ranking_private.versions (
  course_id text not null,
  course_version text not null,
  rules_version text not null,
  min_cs integer not null check (min_cs > 0),
  full_cs integer not null check (full_cs >= min_cs),
  zero_cs integer not null check (zero_cs > full_cs),
  accepting boolean not null default false,
  primary key (course_id, course_version, rules_version)
);

-- 記録を取り始めた版の数値は変更しない。基準を変える場合は新しい版を追加する。
-- 最短時間はコース距離、カーブの短縮、最高速・下り・加速アイテムを含めて
-- 安全側へ余裕を取った下限。実際に操作して走ったことを証明するものではない。
insert into inubo_ranking_private.versions
  (course_id, course_version, rules_version, min_cs, full_cs, zero_cs, accepting)
values
  ('park', 'park-1', 'rules-1', 3000, 6000, 11000, true),
  ('shopping-street', 'street-1', 'rules-1', 2400, 4600, 8800, false),
  ('riverside', 'river-1', 'rules-1', 2800, 4800, 9200, false);

create sequence inubo_ranking_private.finish_seq as bigint;

create table inubo_ranking_private.runs (
  run_id uuid primary key,
  participant_id uuid not null,
  course_id text not null,
  course_version text not null,
  rules_version text not null,
  dog_id text not null check (dog_id in ('shiba', 'corgi', 'whippet')),
  display_name text not null check (char_length(display_name) between 1 and 16),
  started_at timestamptz not null default clock_timestamp(),
  record_cs integer check (record_cs > 0),
  time_score integer check (time_score between 0 and 5000),
  trick_score integer check (trick_score between 0 and 5000),
  total integer check (total between 0 and 10000),
  foreign key (course_id, course_version, rules_version)
    references inubo_ranking_private.versions (course_id, course_version, rules_version),
  check (
    (record_cs is null and time_score is null and trick_score is null and total is null)
    or (record_cs is not null and time_score is not null and trick_score is not null and total is not null
      and total = time_score + trick_score)
  )
);

create table inubo_ranking_private.best (
  course_id text not null,
  course_version text not null,
  rules_version text not null,
  metric text not null check (metric in ('total', 'time')),
  participant_id uuid not null,
  order_value integer not null,
  achieved_seq bigint not null,
  display_name text not null,
  dog_id text not null,
  primary key (course_id, course_version, rules_version, metric, participant_id),
  check ((metric = 'total' and order_value between -10000 and 0) or (metric = 'time' and order_value > 0))
);

create index inubo_ranking_best_order on inubo_ranking_private.best
  (course_id, course_version, rules_version, metric, order_value, achieved_seq, participant_id);

alter table inubo_ranking_private.versions enable row level security;
alter table inubo_ranking_private.runs enable row level security;
alter table inubo_ranking_private.best enable row level security;
revoke all on all tables in schema inubo_ranking_private from public, anon, authenticated, service_role;
revoke all on sequence inubo_ranking_private.finish_seq from public, anon, authenticated, service_role;
grant select on inubo_ranking_private.versions, inubo_ranking_private.runs, inubo_ranking_private.best to inubo_ranking_executor;
grant insert (run_id, participant_id, course_id, course_version, rules_version, dog_id, display_name),
  update (record_cs, time_score, trick_score, total) on inubo_ranking_private.runs to inubo_ranking_executor;
grant insert, update (order_value, achieved_seq, display_name, dog_id) on inubo_ranking_private.best to inubo_ranking_executor;
grant usage on sequence inubo_ranking_private.finish_seq to inubo_ranking_executor;
create policy executor_read on inubo_ranking_private.versions for select to inubo_ranking_executor using (true);
create policy executor_runs on inubo_ranking_private.runs for all to inubo_ranking_executor using (true) with check (true);
create policy executor_best on inubo_ranking_private.best for all to inubo_ranking_executor using (true) with check (true);

create function inubo_ranking_private.start(
  p_run_id uuid, p_participant_id uuid, p_course_id text, p_course_version text, p_rules_version text,
  p_dog_id text, p_display_name text, p_consent boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare
  existing inubo_ranking_private.runs%rowtype;
  -- 入力欄の trim() と同じ空白を除く。全角・改行しない空白だけの名前も保存しない。
  player_name text := pg_catalog.btrim(p_display_name,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
begin
  if p_consent is distinct from true or p_run_id is null or p_participant_id is null
    or p_dog_id is null or p_dog_id not in ('shiba', 'corgi', 'whippet')
    or player_name is null or pg_catalog.char_length(player_name) not between 1 and 16
    or player_name ~ '[[:cntrl:]]' or player_name ~ '^[[:space:]　]+$' then
    return 'rejected';
  end if;

  insert into inubo_ranking_private.runs
    (run_id, participant_id, course_id, course_version, rules_version, dog_id, display_name)
  select p_run_id, p_participant_id, v.course_id, v.course_version, v.rules_version, p_dog_id, player_name
  from inubo_ranking_private.versions v
  where (v.course_id, v.course_version, v.rules_version) = (p_course_id, p_course_version, p_rules_version)
    and v.accepting
  on conflict (run_id) do nothing;
  if found then return 'accepted'; end if;

  select * into existing from inubo_ranking_private.runs r where r.run_id = p_run_id;
  if not found then return 'rejected'; end if;
  if (existing.participant_id, existing.course_id, existing.course_version, existing.rules_version, existing.dog_id, existing.display_name)
    is not distinct from (p_participant_id, p_course_id, p_course_version, p_rules_version, p_dog_id, player_name) then
    return 'duplicate';
  end if;
  return 'conflict';
end;
$$;

create function inubo_ranking_private.finish(
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
    or p_trick_score is null or p_trick_score not between 0 and 5000
    or p_total is null or p_total not between 0 and 10000 then return 'rejected'; end if;

  span := version.zero_cs::bigint - version.full_cs;
  expected_time_score := case
    when p_record_cs <= version.full_cs then 5000
    when p_record_cs >= version.zero_cs then 0
    else (10000 * (version.zero_cs::bigint - p_record_cs) + span) / (2 * span)
  end;
  if p_time_score <> expected_time_score or p_total <> expected_time_score + p_trick_score then return 'rejected'; end if;

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

create function inubo_ranking_private.board(
  p_course_id text, p_course_version text, p_rules_version text, p_metric text, p_limit integer
) returns jsonb language sql stable security definer set search_path = '' as $$
  with top as (
    select b.order_value, b.achieved_seq, b.participant_id, b.display_name, b.dog_id
    from inubo_ranking_private.best b
    where (b.course_id, b.course_version, b.rules_version, b.metric) = (p_course_id, p_course_version, p_rules_version, p_metric)
    order by b.order_value, b.achieved_seq, b.participant_id
    limit least(greatest(coalesce(p_limit, 30), 0), 30)
  ), ranked as (
    select rank() over (order by order_value) as rank, top.* from top
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'rank', rank, 'display_name', display_name,
    'value', case when p_metric = 'total' then -order_value else order_value end, 'dog_id', dog_id
  ) order by order_value, achieved_seq, participant_id), '[]'::jsonb)
  from ranked;
$$;

alter function inubo_ranking_private.start(uuid, uuid, text, text, text, text, text, boolean) owner to inubo_ranking_executor;
alter function inubo_ranking_private.finish(uuid, uuid, text, text, text, text, integer, integer, integer, integer) owner to inubo_ranking_executor;
alter function inubo_ranking_private.board(text, text, text, text, integer) owner to inubo_ranking_executor;
revoke create on schema inubo_ranking_private from inubo_ranking_executor;
revoke all on all functions in schema inubo_ranking_private from public, anon, authenticated, service_role;
grant execute on all functions in schema inubo_ranking_private to anon, authenticated;

-- SQL 本体は作成時に専用関数を解決する。利用者に非公開領域の使用権限を渡さない。
create function public.inubo_ranking_start(
  p_run_id uuid, p_participant_id uuid, p_course_id text, p_course_version text, p_rules_version text,
  p_dog_id text, p_display_name text, p_consent boolean
) returns text language sql security invoker set search_path = ''
return inubo_ranking_private.start(p_run_id, p_participant_id, p_course_id, p_course_version, p_rules_version,
  p_dog_id, p_display_name, p_consent);

create function public.inubo_ranking_finish(
  p_run_id uuid, p_participant_id uuid, p_course_id text, p_course_version text, p_rules_version text,
  p_dog_id text, p_record_cs integer, p_time_score integer, p_trick_score integer, p_total integer
) returns text language sql security invoker set search_path = ''
return inubo_ranking_private.finish(p_run_id, p_participant_id, p_course_id, p_course_version, p_rules_version,
  p_dog_id, p_record_cs, p_time_score, p_trick_score, p_total);

create function public.inubo_ranking_board(
  p_course_id text, p_course_version text, p_rules_version text, p_metric text, p_limit integer
) returns jsonb language sql stable security invoker set search_path = ''
return inubo_ranking_private.board(p_course_id, p_course_version, p_rules_version, p_metric, p_limit);

revoke all on function public.inubo_ranking_start(uuid, uuid, text, text, text, text, text, boolean),
  public.inubo_ranking_finish(uuid, uuid, text, text, text, text, integer, integer, integer, integer),
  public.inubo_ranking_board(text, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.inubo_ranking_start(uuid, uuid, text, text, text, text, text, boolean),
  public.inubo_ranking_finish(uuid, uuid, text, text, text, text, integer, integer, integer, integer),
  public.inubo_ranking_board(text, text, text, text, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
