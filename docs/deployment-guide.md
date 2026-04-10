# Deployment guide

## Option A: Cloudflare Pages with GitHub

### 1) Create the repo
Push this project to a new GitHub repository.

### 2) Deploy in Cloudflare Pages
Create a Pages project from the GitHub repo.

Use:
- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`

### 3) Attach the custom domain
In the Pages project:
- Open **Custom domains**
- Add `images.jonathan-harris.online`

Important:
- Add the custom domain in the Pages dashboard first.
- Do not just point DNS at `*.pages.dev` without associating the domain in Pages.

### 4) DNS
If `jonathan-harris.online` is already hosted in Cloudflare on the same account:
- Cloudflare can add or confirm the CNAME automatically as part of Pages custom domain setup.

If DNS is external:
- Add a `CNAME` record
- Name: `images`
- Target: `<your-pages-project>.pages.dev`

### 5) Test
Check the root and a few redirects, for example:
- `/site-logo`
- `/facebook-icon`
- a couple of book image URLs

## Option B: Bulk Redirects instead of Pages
1. Create a Bulk Redirect List in Cloudflare.
2. Import `cloudflare-bulk-redirects-images.csv`.
3. Create a Bulk Redirect Rule attached to that list.
4. Ensure `images.jonathan-harris.online` resolves through Cloudflare.

## Current note
This project is aimed at website and social media image URLs only.
Podcast and blog image systems remain separate.
