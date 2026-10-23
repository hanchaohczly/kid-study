begin;

with expanded_chapters as (
  select
    textbook.id as import_id,
    chapter.value as chapter,
    chapter.ordinality as chapter_order,
    lower(
      regexp_replace(
        regexp_replace(
          chapter.value->>'title',
          '^第[〇零一二三四五六七八九十百0-9]+章[[:space:]]*[-—–:：·、]?[[:space:]]*',
          ''
        ),
        '[[:space:]—–:：·、，,。()（）-]',
        '',
        'g'
      )
    ) as normalized_title,
    (chapter.value->>'title') ~
      '^第[〇零一二三四五六七八九十百0-9]+章' as has_official_title
  from textbook_import textbook
  cross join lateral jsonb_array_elements(textbook.draft->'chapters')
    with ordinality as chapter(value, ordinality)
),
grouped_chapters as (
  select
    import_id,
    normalized_title,
    min(chapter_order) as first_chapter_order,
    min((chapter->>'pageStart')::integer) as page_start,
    max((chapter->>'pageEnd')::integer) as page_end,
    (
      array_agg(
        chapter->>'code'
        order by has_official_title desc, chapter_order
      )
    )[1] as code,
    regexp_replace(
      (
        array_agg(
          chapter->>'title'
          order by has_official_title desc, chapter_order
        )
      )[1],
      '^(第[〇零一二三四五六七八九十百0-9]+章)[[:space:]]*[-—–:：·、]?[[:space:]]*',
      '\1 '
    ) as title
  from expanded_chapters
  group by import_id, normalized_title
),
ranked_knowledge_points as (
  select
    chapter.import_id,
    chapter.normalized_title,
    knowledge_point.value as knowledge_point,
    chapter.chapter_order,
    knowledge_point.ordinality as knowledge_point_order,
    row_number() over (
      partition by
        chapter.import_id,
        chapter.normalized_title,
        knowledge_point.value->>'code'
      order by chapter.chapter_order, knowledge_point.ordinality
    ) as duplicate_rank
  from expanded_chapters chapter
  cross join lateral jsonb_array_elements(chapter.chapter->'knowledgePoints')
    with ordinality as knowledge_point(value, ordinality)
),
rebuilt_chapters as (
  select
    grouped.import_id,
    grouped.normalized_title,
    grouped.first_chapter_order,
    jsonb_build_object(
      'code', grouped.code,
      'title', grouped.title,
      'pageStart', grouped.page_start,
      'pageEnd', grouped.page_end,
      'knowledgePoints',
      coalesce(
        (
          select jsonb_agg(
            ranked.knowledge_point
            order by ranked.chapter_order, ranked.knowledge_point_order
          )
          from ranked_knowledge_points ranked
          where ranked.import_id = grouped.import_id
            and ranked.normalized_title = grouped.normalized_title
            and ranked.duplicate_rank = 1
        ),
        '[]'::jsonb
      )
    ) as chapter
  from grouped_chapters grouped
),
rebuilt_drafts as (
  select
    textbook.id as import_id,
    jsonb_set(
      textbook.draft,
      '{chapters}',
      jsonb_agg(
        rebuilt.chapter
        order by rebuilt.first_chapter_order
      )
    ) as draft
  from textbook_import textbook
  join rebuilt_chapters rebuilt on rebuilt.import_id = textbook.id
  group by textbook.id, textbook.draft
)
update textbook_import textbook
set draft = rebuilt.draft
from rebuilt_drafts rebuilt
where textbook.id = rebuilt.import_id;

with textbook_knowledge_points as (
  select
    textbook.family_id,
    knowledge_point.value->>'code' as code,
    knowledge_point.value->>'name' as name,
    min(chapter.value->>'title') as chapter
  from textbook_import textbook
  cross join lateral jsonb_array_elements(textbook.draft->'chapters')
    as chapter(value)
  cross join lateral jsonb_array_elements(chapter.value->'knowledgePoints')
    as knowledge_point(value)
  where textbook.status = 'confirmed'
  group by
    textbook.family_id,
    knowledge_point.value->>'code',
    knowledge_point.value->>'name'
  having count(distinct chapter.value->>'title') = 1
)
update knowledge_point stored
set
  chapter = textbook.chapter,
  updated_at = now()
from textbook_knowledge_points textbook
where stored.family_id = textbook.family_id
  and stored.code = textbook.code
  and stored.name = textbook.name
  and stored.chapter is distinct from textbook.chapter;

with canonical_chapter_titles as (
  select
    textbook.family_id,
    lower(
      regexp_replace(
        regexp_replace(
          chapter.value->>'title',
          '^第[〇零一二三四五六七八九十百0-9]+章[[:space:]]*[-—–:：·、]?[[:space:]]*',
          ''
        ),
        '[[:space:]—–:：·、，,。()（）-]',
        '',
        'g'
      )
    ) as normalized_title,
    min(chapter.value->>'title') as chapter
  from textbook_import textbook
  cross join lateral jsonb_array_elements(textbook.draft->'chapters')
    as chapter(value)
  where textbook.status = 'confirmed'
  group by textbook.family_id, normalized_title
  having count(distinct chapter.value->>'title') = 1
)
update knowledge_point stored
set
  chapter = canonical.chapter,
  updated_at = now()
from canonical_chapter_titles canonical
where stored.family_id = canonical.family_id
  and lower(
    regexp_replace(
      regexp_replace(
        stored.chapter,
        '^第[〇零一二三四五六七八九十百0-9]+章[[:space:]]*[-—–:：·、]?[[:space:]]*',
        ''
      ),
      '[[:space:]—–:：·、，,。()（）-]',
      '',
      'g'
    )
  ) = canonical.normalized_title
  and stored.chapter is distinct from canonical.chapter;

commit;
