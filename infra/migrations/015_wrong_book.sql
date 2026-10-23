begin;

create table wrong_item (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  source text not null check (source in ('system', 'photo')),
  question_id uuid,
  kp_id uuid,
  stem text not null,
  student_answer text,
  answer_key text,
  analysis text,
  photo_mime_type text,
  photo_data bytea,
  mapping_confidence numeric(5, 4),
  mapping_method text not null
    check (mapping_method in ('question', 'vision', 'manual')),
  mapping_confirmed boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'mastered', 'archived')),
  tags text[] not null default '{}',
  note text not null default '',
  wrong_count integer not null default 1 check (wrong_count > 0),
  review_count integer not null default 0 check (review_count >= 0),
  correct_review_streak integer not null default 0
    check (correct_review_streak >= 0),
  first_wrong_at timestamptz not null,
  latest_wrong_at timestamptz not null,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, question_id)
    references question(family_id, id) on delete set null,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete restrict,
  check (
    (source = 'system' and question_id is not null)
    or source = 'photo'
  ),
  check (
    (photo_data is null and photo_mime_type is null)
    or (
      photo_data is not null
      and photo_mime_type in ('image/jpeg', 'image/png', 'image/webp')
    )
  ),
  check (
    mapping_confidence is null
    or mapping_confidence between 0 and 1
  )
);

create unique index wrong_item_system_question_idx
  on wrong_item (family_id, kid_id, question_id)
  where source = 'system' and question_id is not null;
create index wrong_item_family_kid_status_idx
  on wrong_item (family_id, kid_id, status, latest_wrong_at desc);
create index wrong_item_family_kp_idx
  on wrong_item (family_id, kp_id, latest_wrong_at desc);

create table wrong_item_occurrence (
  id uuid primary key,
  wrong_item_id uuid not null,
  family_id uuid not null references family(id) on delete cascade,
  submission_id uuid not null,
  student_answer text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (family_id, submission_id),
  foreign key (family_id, wrong_item_id)
    references wrong_item(family_id, id) on delete cascade,
  foreign key (submission_id)
    references training_answer_submission(id) on delete cascade
);

create index wrong_item_occurrence_item_idx
  on wrong_item_occurrence (wrong_item_id, occurred_at desc);

create table wrong_item_review (
  id uuid primary key,
  wrong_item_id uuid not null,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  result text not null check (result in ('correct', 'incorrect')),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  foreign key (family_id, wrong_item_id)
    references wrong_item(family_id, id) on delete cascade,
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, reviewed_by)
    references app_user(family_id, id) on delete restrict
);

create index wrong_item_review_item_idx
  on wrong_item_review (wrong_item_id, reviewed_at desc);

commit;
