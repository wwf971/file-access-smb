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

create table if not exists smb_internal_file_access_point (
  fileAccessPointId text primary key,
  name text not null,
  fileAccessPointSmbExternalInfo jsonb not null default '{}'::jsonb,
  pathRoot text not null default '/',
  metadata jsonb not null default '{}'::jsonb,
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now()
);

alter table smb_internal_file_access_point
  add column if not exists fileAccessPointSmbExternalInfo jsonb not null default '{}'::jsonb;

create index if not exists idx_smb_internal_file_access_point_created_at
  on smb_internal_file_access_point(createdAt);

commit;
