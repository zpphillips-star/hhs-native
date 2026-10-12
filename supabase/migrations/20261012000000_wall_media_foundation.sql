-- Phase 1 Wall media foundation.
-- Normalizes post/comment attachments while preserving legacy posts.photo_url clients.

create table if not exists public.wall_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null default 'post-photos',
  storage_path text not null,
  public_url text,
  media_kind text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  duration_ms integer,
  thumbnail_bucket text,
  thumbnail_path text,
  thumbnail_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wall_media_one_parent check (
    (post_id is not null and comment_id is null)
    or (post_id is null and comment_id is not null)
  ),
  constraint wall_media_kind_check check (media_kind in ('image', 'video', 'gif')),
  constraint wall_media_mime_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm')
  ),
  constraint wall_media_byte_size_check check (byte_size > 0 and byte_size <= 26214400),
  constraint wall_media_dimensions_check check (
    (width is null or width > 0)
    and (height is null or height > 0)
    and (duration_ms is null or duration_ms >= 0)
  ),
  constraint wall_media_bucket_check check (bucket = 'post-photos'),
  constraint wall_media_path_owner_check check (storage_path like (user_id::text || '/wall/%')),
  constraint wall_media_no_external_public_url_check check (
    public_url is null
    or public_url like ('https://%/storage/v1/object/public/' || bucket || '/' || storage_path)
  ),
  constraint wall_media_thumbnail_url_check check (
    thumbnail_url is null
    or (
      thumbnail_bucket = 'post-photos'
      and thumbnail_path is not null
      and thumbnail_url like ('https://%/storage/v1/object/public/' || thumbnail_bucket || '/' || thumbnail_path)
    )
  )
);

create index if not exists wall_media_post_order_idx
  on public.wall_media (post_id, sort_order, created_at)
  where post_id is not null;

create index if not exists wall_media_comment_order_idx
  on public.wall_media (comment_id, sort_order, created_at)
  where comment_id is not null;

create index if not exists wall_media_user_created_idx
  on public.wall_media (user_id, created_at desc);

create unique index if not exists wall_media_post_sort_unique_idx
  on public.wall_media (post_id, sort_order)
  where post_id is not null;

create unique index if not exists wall_media_comment_sort_unique_idx
  on public.wall_media (comment_id, sort_order)
  where comment_id is not null;

create unique index if not exists wall_media_storage_object_unique_idx
  on public.wall_media (bucket, storage_path);

create or replace function public.touch_wall_media_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wall_media_touch_updated_at on public.wall_media;
create trigger wall_media_touch_updated_at
before update on public.wall_media
for each row execute function public.touch_wall_media_updated_at();

create or replace function public.validate_wall_media_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
  existing_count integer;
  existing_bytes bigint;
  max_count integer;
  max_total_bytes bigint;
begin
  if new.post_id is not null then
    select user_id into parent_owner from public.posts where id = new.post_id;
    max_count := 10;
    max_total_bytes := 104857600;
  else
    select user_id into parent_owner from public.post_comments where id = new.comment_id;
    max_count := 4;
    max_total_bytes := 41943040;
  end if;

  if parent_owner is null then
    raise exception 'Wall media parent not found';
  end if;

  if new.user_id <> parent_owner then
    raise exception 'Wall media user must own the parent post/comment';
  end if;

  select count(*), coalesce(sum(byte_size), 0)
    into existing_count, existing_bytes
  from public.wall_media
  where id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      (new.post_id is not null and post_id = new.post_id)
      or (new.comment_id is not null and comment_id = new.comment_id)
    );

  if existing_count >= max_count then
    raise exception 'Too many Wall media attachments';
  end if;

  if existing_bytes + new.byte_size > max_total_bytes then
    raise exception 'Wall media attachments exceed byte-size total';
  end if;

  return new;
end;
$$;

drop trigger if exists wall_media_validate on public.wall_media;
create trigger wall_media_validate
before insert or update on public.wall_media
for each row execute function public.validate_wall_media_row();

alter table public.wall_media enable row level security;

drop policy if exists "Wall media is readable by authenticated members" on public.wall_media;
create policy "Wall media is readable by authenticated members"
on public.wall_media for select
to authenticated
using (true);

drop policy if exists "Members can attach media they own" on public.wall_media;
create policy "Members can attach media they own"
on public.wall_media for insert
to authenticated
with check (
  auth.uid() = user_id
  and bucket = 'post-photos'
  and storage_path like (auth.uid()::text || '/wall/%')
);

drop policy if exists "Members can update media they own before moderation" on public.wall_media;
create policy "Members can update media they own before moderation"
on public.wall_media for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and bucket = 'post-photos'
  and storage_path like (auth.uid()::text || '/wall/%')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-photos',
  'post-photos',
  true,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Wall media objects are publicly readable" on storage.objects;
create policy "Wall media objects are publicly readable"
on storage.objects for select
using (bucket_id = 'post-photos');

drop policy if exists "Members upload Wall media under their user folder" on storage.objects;
create policy "Members upload Wall media under their user folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'post-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'wall'
);

drop policy if exists "Members clean up their own unattached Wall uploads" on storage.objects;
create policy "Members clean up their own unattached Wall uploads"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'post-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'wall'
);

create or replace view public.wall_media_storage_orphans as
select objects.bucket_id,
       objects.name as storage_path,
       objects.created_at,
       objects.updated_at,
       objects.metadata
from storage.objects
left join public.wall_media
  on wall_media.bucket = objects.bucket_id
 and wall_media.storage_path = objects.name
where objects.bucket_id = 'post-photos'
  and (storage.foldername(objects.name))[2] = 'wall'
  and wall_media.id is null
  and objects.created_at < now() - interval '24 hours';

comment on view public.wall_media_storage_orphans is
  'Operational cleanup queue: stale direct uploads not linked from wall_media. Delete with the Supabase Storage service-role API after review.';

