begin;

delete from guide_attempt
where family_id = '11111111-1111-4111-8111-111111111111'
  and question_id in (
    select id
    from question
    where family_id = '11111111-1111-4111-8111-111111111111'
      and kp_id in (
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002'
      )
  );

delete from training_attempt
where family_id = '11111111-1111-4111-8111-111111111111'
  and question_id in (
    select id
    from question
    where family_id = '11111111-1111-4111-8111-111111111111'
      and kp_id in (
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002'
      )
  );

delete from assessment
where family_id = '11111111-1111-4111-8111-111111111111'
  and knowledge_point_ids && array[
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid
  ];

delete from assessment_question
where family_id = '11111111-1111-4111-8111-111111111111'
  and question_id in (
    select id
    from question
    where family_id = '11111111-1111-4111-8111-111111111111'
      and kp_id in (
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002'
      )
  );

delete from question
where family_id = '11111111-1111-4111-8111-111111111111'
  and kp_id in (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002'
  );

delete from knowledge_point
where family_id = '11111111-1111-4111-8111-111111111111'
  and id in (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002'
  );

commit;
