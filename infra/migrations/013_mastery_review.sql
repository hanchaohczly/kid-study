begin;

create table training_answer_submission (
  id uuid primary key,
  attempt_id uuid not null,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  question_id uuid not null,
  kp_id uuid not null,
  answer text not null,
  correct boolean not null,
  hint_level smallint not null check (hint_level between 0 and 3),
  submitted_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, family_id, kid_id, question_id),
  foreign key (attempt_id, family_id, kid_id, question_id)
    references training_attempt(id, family_id, kid_id, question_id)
    on delete cascade,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete restrict
);

create index training_answer_submission_evidence_idx
  on training_answer_submission (
    family_id, kid_id, kp_id, submitted_at, id
  );

insert into training_answer_submission (
  id, attempt_id, family_id, kid_id, question_id, kp_id,
  answer, correct, hint_level, submitted_at
)
select
  gen_random_uuid(),
  ta.id,
  ta.family_id,
  ta.kid_id,
  ta.question_id,
  q.kp_id,
  qp.answer_key,
  true,
  ta.hint_level,
  ta.completed_at
from training_attempt ta
join question q
  on q.family_id = ta.family_id and q.id = ta.question_id
join question_private qp
  on qp.family_id = ta.family_id and qp.question_id = ta.question_id
where ta.completed_at is not null
  and not exists (
    select 1
    from training_answer_submission answer
    where answer.attempt_id = ta.id
  );

create table mastery_projection (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  kp_id uuid not null,
  model_version text not null,
  status text not null
    check (status in ('insufficient', 'weak', 'basic', 'mastered')),
  score numeric(6, 5),
  sample_count integer not null check (sample_count >= 0),
  independent_count integer not null check (independent_count >= 0),
  independent_correct_count integer not null
    check (independent_correct_count >= 0),
  spaced_day_count integer not null check (spaced_day_count >= 0),
  evidence_from timestamptz not null,
  evidence_to timestamptz not null,
  evidence_fingerprint text not null,
  calculation_details jsonb not null,
  projection_version integer not null default 1
    check (projection_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, kid_id, kp_id, model_version),
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete restrict,
  check (
    (status = 'insufficient' and score is null)
    or (status <> 'insufficient' and score between 0 and 1)
  ),
  check (jsonb_typeof(calculation_details) = 'object')
);

create index mastery_projection_family_kid_status_idx
  on mastery_projection (family_id, kid_id, status, updated_at desc);

create table mastery_review (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  projection_id uuid not null,
  projection_version integer not null check (projection_version > 0),
  reviewer_id uuid not null,
  decision text not null check (decision in ('agree', 'disagree', 'unsure')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (family_id, projection_id)
    references mastery_projection(family_id, id) on delete cascade,
  foreign key (family_id, reviewer_id)
    references app_user(family_id, id) on delete restrict,
  check (note is null or char_length(note) <= 500)
);

create index mastery_review_projection_created_idx
  on mastery_review (projection_id, created_at desc);

commit;
