begin;

create table if not exists smb_file_access_point (
  fileAccessPointId text primary key,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now()
);

create index if not exists idx_smb_file_access_point_created_at
  on smb_file_access_point(createdAt);

commit;
