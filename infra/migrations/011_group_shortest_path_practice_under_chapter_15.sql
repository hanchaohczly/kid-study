begin;

update knowledge_point
set
  chapter = '第十五章 轴对称',
  updated_at = now()
where (
    lower(
      regexp_replace(
        chapter,
        '[[:space:]—–:：·、，,。()（）_-]',
        '',
        'g'
      )
    ) like '%最短路径%'
    or lower(
      regexp_replace(
        chapter,
        '[[:space:]—–:：·、，,。()（）_-]',
        '',
        'g'
      )
    ) = '综合与实践'
  )
  and lower(
    regexp_replace(
      coalesce(name, '') || coalesce(summary, ''),
      '[[:space:]—–:：·、，,。()（）_-]',
      '',
      'g'
    )
  ) like '%最短路径%';

with expanded_chapters_base as (
  select
    textbook.id as import_id,
    textbook.draft,
    chapter.value as chapter,
    chapter.ordinality as chapter_order,
    lower(
      regexp_replace(
        chapter.value->>'title',
        '[[:space:]—–:：·、，,。()（）_-]',
        '',
        'g'
      )
    ) as normalized_title
  from textbook_import textbook
  cross join lateral jsonb_array_elements(textbook.draft->'chapters')
    with ordinality as chapter(value, ordinality)
),
expanded_chapters as (
  select
    chapter.*,
    (
      chapter.normalized_title like '%最短路径%'
      or (
        chapter.normalized_title = '综合与实践'
        and exists (
          select 1
          from jsonb_array_elements(chapter.chapter->'knowledgePoints')
            as knowledge_point(value)
          where lower(
            regexp_replace(
              coalesce(knowledge_point.value->>'name', '')
                || coalesce(knowledge_point.value->>'summary', ''),
              '[[:space:]—–:：·、，,。()（）_-]',
              '',
              'g'
            )
          ) like '%最短路径%'
        )
      )
    ) as is_shortest_path_practice
  from expanded_chapters_base chapter
),
chapter_fifteen as (
  select distinct on (import_id)
    import_id,
    chapter,
    chapter_order
  from expanded_chapters
  where normalized_title = '第十五章轴对称'
  order by import_id, chapter_order
),
shortest_path_practice as (
  select
    chapter.import_id,
    min(
      least(
        (chapter.chapter->>'pageStart')::integer,
        coalesce(
          knowledge_point_bounds.page_start,
          (chapter.chapter->>'pageStart')::integer
        )
      )
    ) as page_start,
    max(
      greatest(
        (chapter.chapter->>'pageEnd')::integer,
        coalesce(
          knowledge_point_bounds.page_end,
          (chapter.chapter->>'pageEnd')::integer
        )
      )
    ) as page_end
  from expanded_chapters chapter
  cross join lateral (
    select
      min((knowledge_point.value->>'pageStart')::integer) as page_start,
      max((knowledge_point.value->>'pageEnd')::integer) as page_end
    from jsonb_array_elements(chapter.chapter->'knowledgePoints')
      as knowledge_point(value)
  ) knowledge_point_bounds
  where chapter.is_shortest_path_practice
  group by chapter.import_id
),
ranked_knowledge_points as (
  select
    chapter.import_id,
    knowledge_point.value as knowledge_point,
    row_number() over (
      partition by chapter.import_id, knowledge_point.value->>'code'
      order by
        (chapter.normalized_title = '第十五章轴对称') desc,
        chapter.chapter_order,
        knowledge_point.ordinality
    ) as duplicate_rank
  from expanded_chapters chapter
  cross join lateral jsonb_array_elements(chapter.chapter->'knowledgePoints')
    with ordinality as knowledge_point(value, ordinality)
  where chapter.normalized_title = '第十五章轴对称'
     or chapter.is_shortest_path_practice
),
merged_knowledge_points as (
  select
    import_id,
    jsonb_agg(
      knowledge_point
      order by
        (knowledge_point->>'pageStart')::integer,
        (knowledge_point->>'pageEnd')::integer,
        knowledge_point->>'code',
        knowledge_point->>'name'
    ) as knowledge_points
  from ranked_knowledge_points
  where duplicate_rank = 1
  group by import_id
),
merged_chapter_fifteen as (
  select
    parent.import_id,
    parent.chapter_order,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          parent.chapter,
          '{pageStart}',
          to_jsonb(
            least(
              (parent.chapter->>'pageStart')::integer,
              practice.page_start
            )
          )
        ),
        '{pageEnd}',
        to_jsonb(
          greatest(
            (parent.chapter->>'pageEnd')::integer,
            practice.page_end
          )
        )
      ),
      '{knowledgePoints}',
      merged.knowledge_points
    ) as chapter
  from chapter_fifteen parent
  join shortest_path_practice practice using (import_id)
  join merged_knowledge_points merged using (import_id)
),
rebuilt_drafts as (
  select
    textbook.id as import_id,
    jsonb_set(
      textbook.draft,
      '{chapters}',
      jsonb_agg(
        case
          when chapter.chapter_order = merged.chapter_order
            then merged.chapter
          else chapter.chapter
        end
        order by chapter.chapter_order
      )
    ) as draft
  from textbook_import textbook
  join expanded_chapters chapter on chapter.import_id = textbook.id
  join merged_chapter_fifteen merged on merged.import_id = textbook.id
  where not chapter.is_shortest_path_practice
  group by textbook.id, textbook.draft
)
update textbook_import textbook
set draft = rebuilt.draft
from rebuilt_drafts rebuilt
where textbook.id = rebuilt.import_id;

commit;
