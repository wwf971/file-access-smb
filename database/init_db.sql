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

alter table smb_internal_file_access_point
  drop column if exists fileAccessPointExternalId;

create index if not exists idx_smb_internal_file_access_point_created_at
  on smb_internal_file_access_point(createdAt);

create table if not exists task (
  taskId bigint primary key,
  userId text not null default '',
  taskType integer not null,
  taskStatus integer not null,
  taskStatusText text not null default '',
  taskInfo jsonb not null default '{}'::jsonb,
  createdAt timestamptz not null default now(),
  createdAtTimeZone integer not null default 0,
  updatedAt timestamptz not null default now(),
  updatedAtTimeZone integer not null default 0,
  startedAt timestamptz,
  startedAtTimeZone integer,
  finishedAt timestamptz,
  finishedAtTimeZone integer,
  heartbeatAt timestamptz,
  heartbeatAtTimeZone integer
);

alter table task
  add column if not exists userId text not null default '';

alter table task
  add column if not exists taskType integer not null default 1;

alter table task
  add column if not exists taskStatus integer not null default 1;

alter table task
  add column if not exists taskStatusText text not null default '';

alter table task
  add column if not exists taskInfo jsonb not null default '{}'::jsonb;

alter table task
  add column if not exists createdAt timestamptz not null default now();

alter table task
  add column if not exists createdAtTimeZone integer not null default 0;

alter table task
  add column if not exists updatedAt timestamptz not null default now();

alter table task
  add column if not exists updatedAtTimeZone integer not null default 0;

alter table task
  add column if not exists startedAt timestamptz;

alter table task
  add column if not exists startedAtTimeZone integer;

alter table task
  add column if not exists finishedAt timestamptz;

alter table task
  add column if not exists finishedAtTimeZone integer;

alter table task
  add column if not exists heartbeatAt timestamptz;

alter table task
  add column if not exists heartbeatAtTimeZone integer;

create index if not exists idx_task_created_at
  on task(createdAt);

create index if not exists idx_task_status_created_at
  on task(taskStatus, createdAt);

create index if not exists idx_task_type_created_at
  on task(taskType, createdAt);

create index if not exists idx_task_user_created_at
  on task(userId, createdAt);

create index if not exists idx_task_heartbeat_at
  on task(heartbeatAt);

commit;
