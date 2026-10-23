begin;

alter table question
  add column question_type text not null default 'single_choice'
    check (question_type in ('single_choice', 'subjective'));

alter table assessment
  add column delivery_mode text not null default 'passport'
    check (delivery_mode in ('passport', 'weekend_paper')),
  add column selection_mode text not null default 'manual'
    check (selection_mode in ('manual', 'auto_core'));

commit;
