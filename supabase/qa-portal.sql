-- AISD ESA QA portal — run in Supabase → SQL Editor on project mgflyiwrzcmxxuxpfotk
-- You do not edit existing survey rows by hand. These two tables store Internal QA
-- answer edits and the Internal → AISD approval handoff. The app also patches
-- esa_question_responses.value so the field ESA app sees the new answer.

create table if not exists esa_qa_edits (
  school_id     text not null,
  room_id       text not null,
  question_id   text not null,
  selected      jsonb not null default '[]'::jsonb,
  previous      jsonb not null default '[]'::jsonb,
  editor        text not null,
  reason        text not null,
  edited_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (school_id, room_id, question_id)
);

create index if not exists esa_qa_edits_school_idx on esa_qa_edits (school_id);

create table if not exists esa_qa_handoffs (
  school_id     text primary key,
  school_name   text not null,
  moved_by      text not null,
  moved_at      timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table esa_qa_edits enable row level security;
alter table esa_qa_handoffs enable row level security;

-- AISD review notes next to campus scores. Run this too if the first script already ran.
-- categories jsonb stores comment threads: { "overall": [{id,author,text,createdAt}], "Studios": [...] }
-- Older rows may still have string values per key; the app migrates those on read.
create table if not exists esa_qa_scoring_notes (
  school_id     text primary key,
  overall       text not null default '',
  categories    jsonb not null default '{}'::jsonb,
  author        text not null default '',
  updated_at    timestamptz not null default now()
);

alter table esa_qa_scoring_notes enable row level security;

-- Live walked-school snapshots. The QA portal refresh button writes here so new
-- campuses can appear without a code deploy. Run this if the earlier tables exist.
create table if not exists esa_qa_school_snapshots (
  school_id          text primary key,
  school_name        text not null,
  campus_id          text not null default '',
  school_class       text not null default 'ELEM',
  school_level       text not null default 'ES',
  room_count         integer not null default 0,
  scored_unit_count  integer not null default 0,
  exported_at        timestamptz not null default now(),
  snapshot           jsonb not null,
  updated_at         timestamptz not null default now()
);

alter table esa_qa_school_snapshots enable row level security;

-- Service role (used by this app's API) bypasses RLS. No anon policies on purpose.
