begin;

create table textbook_analysis_job (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  file_hash text not null check (length(file_hash) = 64),
  analysis_version text not null,
  file_name text not null,
  page_count integer not null check (page_count > 0),
  extracted_characters integer not null check (extracted_characters > 0),
  status text not null
    check (status in ('analyzing', 'failed', 'completed')),
  import_id uuid references textbook_import(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, file_hash, analysis_version)
);

create index textbook_analysis_job_family_updated_idx
  on textbook_analysis_job (family_id, updated_at desc);

create table textbook_analysis_segment (
  job_id uuid not null
    references textbook_analysis_job(id) on delete cascade,
  path text not null,
  status text not null check (status in ('completed', 'split')),
  draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, path),
  check (
    (status = 'completed' and draft is not null and jsonb_typeof(draft) = 'object')
    or (status = 'split' and draft is null)
  )
);

commit;
