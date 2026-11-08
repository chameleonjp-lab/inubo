-- 公園の改定版を追加する。旧版のランキング設定と記録はそのまま残す。
-- 40秒は距離・最高速・下り・フード加速を踏まえた余裕のある下限。
insert into inubo_ranking_private.versions
  (course_id, course_version, rules_version, min_cs, full_cs, zero_cs, accepting)
values
  ('park', 'park-2', 'rules-1', 4000, 8000, 14667, true)
on conflict (course_id, course_version, rules_version) do nothing;
