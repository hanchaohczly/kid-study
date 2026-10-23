begin;

alter table question_private
  add column diagnosis_probes jsonb not null default '{}'::jsonb,
  add constraint question_private_diagnosis_probes_object
    check (jsonb_typeof(diagnosis_probes) = 'object');

create table learning_task (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  source text not null check (source in ('parent', 'school', 'system')),
  kind text not null check (
    kind in ('homework', 'preview', 'review', 'carry_reminder', 'practice')
  ),
  title text not null,
  description text not null default '',
  subject text not null,
  kp_id uuid,
  due_at timestamptz,
  estimated_minutes integer not null default 10
    check (estimated_minutes between 1 and 180),
  priority smallint not null default 2 check (priority between 1 and 3),
  status text not null default 'pending'
    check (status in ('pending', 'claimed_done', 'verified', 'cancelled')),
  created_by uuid not null,
  claimed_done_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, created_by)
    references app_user(family_id, id) on delete restrict,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete set null,
  check (char_length(title) between 1 and 160),
  check (char_length(description) <= 2000)
);

create index learning_task_kid_due_idx
  on learning_task (family_id, kid_id, status, due_at, priority);

create table curriculum_progress (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  subject text not null,
  chapter text not null,
  kp_id uuid,
  source text not null check (
    source in ('parent', 'schedule_ocr', 'school_task_ocr', 'system')
  ),
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  mapping_status text not null
    check (mapping_status in ('mapped', 'unmapped', 'confirmed')),
  effective_date date not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete set null,
  foreign key (family_id, confirmed_by)
    references app_user(family_id, id) on delete restrict,
  check (char_length(subject) between 1 and 80),
  check (char_length(chapter) between 1 and 300),
  check (
    (mapping_status = 'unmapped' and kp_id is null)
    or mapping_status <> 'unmapped'
  )
);

create index curriculum_progress_kid_date_idx
  on curriculum_progress (family_id, kid_id, subject, effective_date desc);

create table review_schedule (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  kp_id uuid not null,
  question_id uuid not null,
  source_submission_id uuid,
  stage text not null
    check (stage in ('t1', 't3', 't14', 'maintenance')),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'superseded')),
  completed_submission_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, kid_id, question_id, stage, due_at),
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete restrict,
  foreign key (family_id, question_id)
    references question(family_id, id) on delete cascade,
  foreign key (source_submission_id)
    references training_answer_submission(id) on delete set null,
  foreign key (completed_submission_id)
    references training_answer_submission(id) on delete set null
);

create unique index review_schedule_one_pending_idx
  on review_schedule (family_id, kid_id, question_id)
  where status = 'pending';
create index review_schedule_due_idx
  on review_schedule (family_id, kid_id, status, due_at);

alter table training_answer_submission
  add column duration_ms integer
    check (duration_ms is null or duration_ms >= 0);

commit;
