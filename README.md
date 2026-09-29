# RouteWise Netlify Setup

The website uses a Netlify Function for `/api/*` and Supabase for shared storage.

## Configure Supabase

1. Open the Supabase project SQL Editor.
2. Run the SQL in `supabase/netlify-state.sql` once.
3. In the Supabase project settings, copy the project URL and the server-side `service_role` key. Do not use the publishable/anon key as the service key.

## Configure Netlify

In the Netlify site's environment variables, add:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_KEY`: the Supabase `service_role` key. Keep this secret and never put it in frontend code.
- `ROUTEWISE_ADMIN_PASSWORD`: a new, strong password for the initial host admin.

Publish these code changes to the Git repository connected to Netlify, then redeploy the site after adding the variables. Sign in to the admin page with `admin@routewise.com` and the password you set for `ROUTEWISE_ADMIN_PASSWORD`.

Accounts and complaints currently in local `data.json` are not imported; users will need to register again on the deployed site. The hosted API stores new passwords as hashes and does not return them to the browser.

## Deploy on Vercel

The catch-all API function is in `api/[...path].js`. Import this repository into Vercel, then add the same three environment variables above to the Vercel project and redeploy. Run the Supabase SQL only once; it is shared by the Netlify and Vercel deployments.
