begin;

create table model_capability_config (
  family_id uuid not null references family(id) on delete cascade,
  capability text not null
    check (capability in ('chat', 'embedding', 'vision')),
  enabled boolean not null default false,
  primary_base_url text not null,
  primary_model text not null,
  primary_api_key text not null,
  fallback_base_url text,
  fallback_model text,
  fallback_api_key text,
  retry_count smallint not null default 2
    check (retry_count between 0 and 5),
  timeout_ms integer not null default 90000
    check (timeout_ms between 5000 and 300000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, capability),
  check (
    (fallback_base_url is null and fallback_model is null and fallback_api_key is null)
    or
    (fallback_base_url is not null and fallback_model is not null and fallback_api_key is not null)
  )
);

commit;
