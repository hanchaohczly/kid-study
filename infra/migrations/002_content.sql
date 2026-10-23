begin;

create table knowledge_point (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  code text not null,
  name text not null,
  chapter text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id),
  unique (family_id, code)
);

create index knowledge_point_family_status_idx
  on knowledge_point (family_id, status, code);

create table question (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kp_id uuid not null,
  stem text not null,
  options jsonb not null,
  difficulty smallint not null check (difficulty between 1 and 5),
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, kp_id)
    references knowledge_point(family_id, id) on delete restrict,
  check (jsonb_typeof(options) = 'array')
);

create index question_family_status_created_idx
  on question (family_id, status, created_at);
create index question_family_kp_idx
  on question (family_id, kp_id);

create table question_private (
  question_id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  answer_key text not null,
  reference_steps jsonb not null,
  scoring_points jsonb not null,
  hints jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (family_id, question_id)
    references question(family_id, id) on delete cascade,
  check (jsonb_typeof(reference_steps) = 'array'),
  check (jsonb_typeof(scoring_points) = 'array'),
  check (jsonb_typeof(hints) = 'array'),
  check (jsonb_array_length(hints) = 3)
);

commit;
