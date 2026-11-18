-- 公園 park-3 の受付。旧版の送信待ちも元の版で受け付ける。
insert into inubo_ranking_private.versions
  (course_id, course_version, rules_version, min_cs, full_cs, zero_cs, accepting)
values
  ('park', 'park-3', 'rules-1', 4000, 8000, 14667, true)
on conflict (course_id, course_version, rules_version) do nothing;
