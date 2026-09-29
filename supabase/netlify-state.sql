create table if not exists public.routewise_state (
  id text primary key check (id = 'main'),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.routewise_state enable row level security;
revoke all on table public.routewise_state from anon, authenticated;
grant all on table public.routewise_state to service_role;

insert into public.routewise_state (id, data)
values (
  'main',
  jsonb_build_object(
    'users', '[]'::jsonb,
    'complaints', '[]'::jsonb,
    'notifications', '[]'::jsonb
  )
)
on conflict (id) do nothing;