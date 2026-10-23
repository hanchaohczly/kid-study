begin;

create table textbook_import (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  file_name text not null,
  page_count integer not null check (page_count > 0),
  extracted_characters integer not null check (extracted_characters > 0),
  status text not null check (status in ('ready_for_review', 'confirmed')),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (family_id, id),
  check (jsonb_typeof(draft) = 'object')
);

create index textbook_import_family_created_idx
  on textbook_import (family_id, created_at desc);

commit;
