begin;

create table wordbook (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  name text not null,
  file_name text not null,
  source_type text not null check (source_type in ('pdf', 'docx', 'text')),
  status text not null default 'ready_for_review'
    check (status in ('ready_for_review', 'confirmed')),
  draft jsonb not null default '[]'::jsonb,
  entry_count integer not null default 0 check (entry_count >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (family_id, id),
  foreign key (family_id, created_by)
    references app_user(family_id, id) on delete restrict,
  check (jsonb_typeof(draft) = 'array'),
  check (char_length(name) between 1 and 120),
  check (char_length(file_name) between 1 and 200)
);

create index wordbook_family_created_idx
  on wordbook (family_id, created_at desc);

create table word_entry (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  wordbook_id uuid not null,
  word text not null,
  normalized_word text not null,
  phonetic text not null default '',
  part_of_speech text not null default '',
  meaning text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (family_id, id),
  unique (wordbook_id, position),
  unique (wordbook_id, normalized_word, part_of_speech),
  foreign key (family_id, wordbook_id)
    references wordbook(family_id, id) on delete cascade,
  check (char_length(word) between 1 and 80),
  check (char_length(meaning) between 1 and 300)
);

create index word_entry_wordbook_position_idx
  on word_entry (wordbook_id, position);

create table word_quiz (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  wordbook_id uuid not null,
  direction text not null check (direction in ('en_to_zh', 'zh_to_en')),
  delivery_mode text not null default 'passport'
    check (delivery_mode in ('passport', 'web')),
  question_count integer not null check (question_count between 1 and 50),
  status text not null default 'assigned'
    check (status in ('assigned', 'completed')),
  assigned_local_date date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (family_id, id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, wordbook_id)
    references wordbook(family_id, id) on delete cascade,
  foreign key (family_id, created_by)
    references app_user(family_id, id) on delete restrict
);

create index word_quiz_family_kid_date_idx
  on word_quiz (family_id, kid_id, assigned_local_date desc, created_at desc);

create table word_quiz_question (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  quiz_id uuid not null,
  entry_id uuid not null,
  position integer not null check (position >= 0),
  stem text not null,
  options jsonb not null,
  answer_key text not null check (answer_key in ('A', 'B', 'C', 'D')),
  unique (quiz_id, position),
  unique (quiz_id, id),
  foreign key (family_id, quiz_id)
    references word_quiz(family_id, id) on delete cascade,
  foreign key (family_id, entry_id)
    references word_entry(family_id, id) on delete cascade,
  check (jsonb_typeof(options) = 'array'),
  check (jsonb_array_length(options) = 4)
);

create index word_quiz_question_quiz_idx
  on word_quiz_question (quiz_id, position);

create table word_quiz_answer (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  quiz_id uuid not null,
  question_id uuid not null,
  kid_id uuid not null,
  selected_key text not null check (selected_key in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  client_event_id text,
  answered_at timestamptz not null default now(),
  unique (quiz_id, question_id),
  unique (family_id, client_event_id),
  foreign key (family_id, quiz_id)
    references word_quiz(family_id, id) on delete cascade,
  foreign key (quiz_id, question_id)
    references word_quiz_question(quiz_id, id) on delete cascade
);

create index word_quiz_answer_family_kid_idx
  on word_quiz_answer (family_id, kid_id, answered_at desc);

create table word_wrong_item (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  kid_id uuid not null,
  entry_id uuid not null,
  wordbook_id uuid not null,
  wrong_count integer not null default 1 check (wrong_count > 0),
  correct_streak integer not null default 0 check (correct_streak >= 0),
  status text not null default 'active'
    check (status in ('active', 'mastered')),
  last_wrong_at timestamptz not null default now(),
  mastered_at timestamptz,
  unique (family_id, kid_id, entry_id),
  foreign key (family_id, kid_id)
    references app_user(family_id, id) on delete cascade,
  foreign key (family_id, entry_id)
    references word_entry(family_id, id) on delete cascade,
  foreign key (family_id, wordbook_id)
    references wordbook(family_id, id) on delete cascade
);

create index word_wrong_item_kid_status_idx
  on word_wrong_item (family_id, kid_id, status, last_wrong_at desc);

commit;
