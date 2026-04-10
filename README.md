# images.jonathan-harris.online

Cloudflare Pages project for stable branded image URLs.

## Purpose
This repo replaces Short.io for website and social media image links.
Each branded path on `images.jonathan-harris.online` redirects to the original ImageKit asset.

## Repo structure

- `public/_redirects` - the live redirect rules used by Cloudflare Pages
- `public/index.html` - minimal landing page for the root URL
- `public/404.html` - basic fallback page
- `cloudflare-bulk-redirects-images.csv` - optional Bulk Redirects import file
- `data/image-url-map.json` - machine-readable map of branded paths to ImageKit URLs

## Recommended deployment
Use **Cloudflare Pages + GitHub**.

### Cloudflare Pages build settings
- **Production branch:** `main`
- **Build command:** `exit 0`
- **Build output directory:** `public`

## Suggested setup steps
1. Create a new GitHub repo.
2. Copy the contents of this bundle into that repo.
3. Commit to `main`.
4. In Cloudflare, create a new **Pages** project from the GitHub repo.
5. Use the build settings shown above.
6. After the first deployment succeeds, go to **Custom domains** in the Pages project.
7. Add `images.jonathan-harris.online` there first.
8. If `jonathan-harris.online` is already on Cloudflare in the same account, let Pages handle the DNS record.
9. Test several image URLs before removing any legacy setup.

## DNS note
If the `jonathan-harris.online` zone is already managed by Cloudflare in the same account, add the custom domain through the **Pages dashboard first** and let Cloudflare create or confirm the DNS automatically.

If you ever need to use external DNS instead, create a `CNAME` for `images` pointing to your project’s `*.pages.dev` hostname.

## Fallback option
If you decide not to use Pages for this hostname, the included CSV can be imported into **Cloudflare Bulk Redirects** instead.
