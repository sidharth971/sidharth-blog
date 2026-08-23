# Sidharth Sahoo — Portfolio & Blog

Public-first personal site — a blog (with categories/subcategories), a resume/portfolio page, and a private dashboard for the owner.

- **Public, no login**: `/` (blog home), `/category/:slug`, `/category/:slug/:subSlug`, `/blog/:slug`, `/resume`.
- **Owner only** (behind `/login`): `/dashboard` (profile overview, stats, recent posts), `/dashboard/compose` (write & publish posts with a live markdown editor), `/dashboard/categories` (manage categories/subcategories).

## Stack

React + TypeScript + Vite, Tailwind CSS v4, shadcn/ui, react-router-dom. Blog posts, categories, and subcategories are stored in Supabase (Postgres + Auth) and fetched client-side — the app itself builds to static assets, so publishing a post never requires a rebuild/redeploy. SEO (Open Graph/Twitter/JSON-LD meta injection + a live `/sitemap.xml`) uses Vercel Edge Middleware/Functions, so deployment targets Vercel specifically.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

Before first run, apply [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor, and create the single owner account under Authentication → Users (email/password) — there is no in-app sign-up.

## Publishing a post from the CLI

Instead of using the in-app editor, write a markdown file with frontmatter and publish it directly:

```markdown
---
title: My Post Title
category: AWS
subcategory: Lambda        # optional
tags: aws, serverless        # optional
status: published             # optional, defaults to "published"
---

Post content in markdown…
```

```bash
npm run publish-post -- path/to/post.md
```

Requires `SUPABASE_OWNER_EMAIL` / `SUPABASE_OWNER_PASSWORD` in `.env.local` (the same owner account as `/login`, not a service-role key). Categories/subcategories are created automatically if they don't exist yet. Re-running against the same title/slug updates the existing post.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally
- `npm run publish-post -- <file>` — publish/update a post from a markdown file
