-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
-- Creates `posts`, `categories`, `subcategories` with Row Level Security so
-- anyone can read published posts/categories but only the authenticated
-- owner can write.

create extension if not exists "pgcrypto";

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table public.subcategories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name        text not null,
  slug        text not null,
  created_at  timestamptz not null default now(),
  unique (category_id, slug)
);

create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) default auth.uid(),
  title           text not null,
  slug            text not null unique,
  excerpt         text,
  content         text not null,
  cover_image_url text,
  tags            text[] not null default '{}',
  status          text not null default 'draft' check (status in ('draft','published')),
  category_id     uuid references public.categories(id) on delete set null,
  subcategory_id  uuid references public.subcategories(id) on delete set null,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index posts_slug_idx on public.posts (slug);
create index posts_status_published_at_idx on public.posts (status, published_at desc);
create index posts_tags_idx on public.posts using gin (tags);
create index posts_category_idx on public.posts (category_id);
create index posts_subcategory_idx on public.posts (subcategory_id);
create index subcategories_category_idx on public.subcategories (category_id);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();

create or replace function public.set_published_at() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end; $$;
create trigger posts_set_published_at before insert or update on public.posts
for each row execute function public.set_published_at();

alter table public.posts enable row level security;
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;

create policy "Public can read published posts" on public.posts
for select to anon, authenticated using (status = 'published');

create policy "Owner can read own posts" on public.posts
for select to authenticated using (auth.uid() = user_id);

create policy "Owner can insert own posts" on public.posts
for insert to authenticated with check (auth.uid() = user_id);

create policy "Owner can update own posts" on public.posts
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Owner can delete own posts" on public.posts
for delete to authenticated using (auth.uid() = user_id);

-- Single-owner project, no public sign-up — the only account that can ever
-- authenticate is the owner, so "any authenticated user" == "the owner".
create policy "Public can read categories" on public.categories
for select to anon, authenticated using (true);

create policy "Owner can manage categories" on public.categories
for all to authenticated using (true) with check (true);

create policy "Public can read subcategories" on public.subcategories
for select to anon, authenticated using (true);

create policy "Owner can manage subcategories" on public.subcategories
for all to authenticated using (true) with check (true);
