begin;

create table training_session (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  local_date date not null,
  started_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, kid_id, local_date),
  unique (id, family_id, kid_id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  check (closed_at is null or closed_at >= started_at)
);

create index training_session_family_kid_date_idx
  on training_session (family_id, kid_id, local_date desc);

create table training_attempt (
  id uuid primary key,
  session_id uuid not null,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  question_id uuid not null,
  hint_level smallint not null default 0 check (hint_level between 0 and 3),
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, family_id, kid_id, question_id),
  foreign key (session_id, family_id, kid_id)
    references training_session(id, family_id, kid_id) on delete cascade,
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, question_id)
    references question(family_id, id) on delete restrict,
  check (completed_at is null or completed_at >= started_at)
);

create index training_attempt_session_idx
  on training_attempt (session_id, started_at);
create index training_attempt_family_kid_question_idx
  on training_attempt (family_id, kid_id, question_id);

create table guide_attempt (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  question_id uuid not null,
  training_attempt_id uuid not null,
  requested_level smallint not null check (requested_level between 1 and 3),
  granted_level smallint not null check (granted_level between 1 and 3),
  generator_model text not null,
  prompt_version text not null,
  checker_version text not null,
  generation_no smallint not null check (generation_no between 1 and 3),
  safety_result text not null
    check (
      safety_result in (
        'pass', 'blocked', 'blocked_regenerated', 'blocked_fallback'
      )
    ),
  reason_codes text[] not null default '{}',
  latency_ms integer not null check (latency_ms >= 0),
  response_fingerprint text not null,
  created_at timestamptz not null default now(),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, question_id)
    references question(family_id, id) on delete restrict,
  foreign key (training_attempt_id, family_id, kid_id, question_id)
    references training_attempt(id, family_id, kid_id, question_id)
    on delete cascade
);

create index guide_attempt_family_kid_created_idx
  on guide_attempt (family_id, kid_id, created_at desc);
create index guide_attempt_safety_result_idx
  on guide_attempt (family_id, safety_result, created_at desc);

commit;
