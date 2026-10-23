begin;

create table family (
  id uuid primary key,
  name text not null,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_user (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  role text not null check (role in ('parent', 'child')),
  display_name text not null,
  credential_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id)
);

create table device (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  owner_id uuid not null references app_user(id) on delete cascade,
  name text not null,
  device_type text not null default 'web',
  revoked_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id)
);

create table learning_event (
  event_id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  actor_id uuid not null references app_user(id) on delete restrict,
  device_id uuid not null references device(id) on delete restrict,
  schema_version integer not null,
  event_type text not null check (
    event_type in (
      'training_started',
      'answer_submitted',
      'hint_requested',
      'hint_used',
      'question_skipped',
      'training_abandoned',
      'training_completed',
      'review_completed'
    )
  ),
  created_at_local timestamptz not null,
  local_seq bigint not null check (local_seq >= 0),
  received_at timestamptz not null default now(),
  causation_id uuid references learning_event(event_id),
  business_key text,
  kp_ids uuid[] not null default '{}',
  payload jsonb not null,
  fingerprint text not null,
  unique (device_id, local_seq)
);

create index learning_event_family_actor_received_idx
  on learning_event (family_id, actor_id, received_at);
create index learning_event_family_type_received_idx
  on learning_event (family_id, event_type, received_at);
create index learning_event_kp_ids_idx
  on learning_event using gin (kp_ids);
create unique index learning_event_training_business_key_idx
  on learning_event (family_id, actor_id, event_type, business_key)
  where business_key is not null
    and event_type in ('training_started', 'training_completed');

create table projection_job (
  id bigint generated always as identity primary key,
  family_id uuid not null references family(id) on delete cascade,
  job_type text not null,
  dedup_key text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'dead_letter')),
  run_after timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index projection_job_active_dedup_idx
  on projection_job (dedup_key)
  where status in ('pending', 'running');
create index projection_job_claim_idx
  on projection_job (status, run_after);

create table audit_log (
  id bigint generated always as identity primary key,
  family_id uuid not null references family(id) on delete cascade,
  actor_id uuid references app_user(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  result text not null,
  request_id text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index audit_log_family_occurred_idx
  on audit_log (family_id, occurred_at desc);

insert into family (id, name)
values ('11111111-1111-4111-8111-111111111111', '开发家庭');

insert into app_user (id, family_id, role, display_name)
values
  (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'parent',
    '家长'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'child',
    '孩子'
  );

insert into device (id, family_id, owner_id, name)
values
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '家长浏览器'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '孩子浏览器'
  );

commit;
