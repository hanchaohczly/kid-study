begin;

alter table question_private
  add column option_hints jsonb;

update question_private
   set option_hints = jsonb_build_object(
     'A', hints,
     'B', hints,
     'C', hints,
     'D', hints
   );

alter table question_private
  alter column option_hints set not null,
  add constraint question_private_option_hints_shape_check
    check (
      jsonb_typeof(option_hints) = 'object'
      and option_hints ?& array['A', 'B', 'C', 'D']
      and jsonb_typeof(option_hints -> 'A') = 'array'
      and jsonb_typeof(option_hints -> 'B') = 'array'
      and jsonb_typeof(option_hints -> 'C') = 'array'
      and jsonb_typeof(option_hints -> 'D') = 'array'
      and jsonb_array_length(option_hints -> 'A') = 3
      and jsonb_array_length(option_hints -> 'B') = 3
      and jsonb_array_length(option_hints -> 'C') = 3
      and jsonb_array_length(option_hints -> 'D') = 3
    );

commit;
