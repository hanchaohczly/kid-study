begin;

alter table knowledge_point
  add column summary text not null default '',
  add column source_page_start integer,
  add column source_page_end integer,
  add column prerequisite_codes text[] not null default '{}',
  add check (
    source_page_start is null or source_page_start > 0
  ),
  add check (
    source_page_end is null or source_page_end >= source_page_start
  );

create table assessment (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null references app_user(id) on delete cascade,
  trigger_type text not null
    check (trigger_type in ('routine', 'parent_initiated')),
  purpose text not null,
  knowledge_point_ids uuid[] not null,
  evidence_summary jsonb not null default '[]',
  status text not null default 'assigned'
    check (status in ('assigned')),
  created_by uuid not null references app_user(id) on delete restrict,
  created_at timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  unique (family_id, id),
  check (cardinality(knowledge_point_ids) > 0),
  check (jsonb_typeof(evidence_summary) = 'array')
);

create index assessment_family_kid_assigned_idx
  on assessment (family_id, kid_id, assigned_at desc);

create table assessment_question (
  assessment_id uuid not null,
  family_id uuid not null,
  question_id uuid not null,
  position smallint not null check (position >= 0),
  primary key (assessment_id, question_id),
  unique (assessment_id, position),
  foreign key (family_id, assessment_id)
    references assessment(family_id, id) on delete cascade,
  foreign key (family_id, question_id)
    references question(family_id, id) on delete restrict
);

create index assessment_question_question_idx
  on assessment_question (family_id, question_id);

commit;
