# FireVerso project guide

## Architecture

This is the user's supplied FireVerso HTML site, extended rather than replaced with a generic template. Vite publishes `index.html` and bundles `src/community.js`. The original, non-sensitive nickname, symbol, bio and sensitivity utilities remain in the inline script. That script exposes the `go` routing function and a small `window.FireVerso` bridge to the account/community module. Do not move member data into the inline script or invent rankings.

## Key directories

- `index.html`: page markup, original visual theme, navigation and local text tools.
- `src/community.js`: Identity flows, account gating, profile editing, leaderboard filters and shared chat UI.
- `src/community.css`: responsive account/community states and accessibility adjustments.
- `src/site.js`: finished site name and description, synchronized with the page's sharing metadata.
- `db/schema.ts`: the source of truth for profiles, score records and chat messages.
- `db/index.ts`: Drizzle's native Netlify Database adapter, instantiated inside the function request.
- `netlify/functions/community.mts`: authenticated API, ownership enforcement, validation, pagination and chat rate limiting.
- `netlify/database/migrations`: generated Drizzle migrations applied by the deployment platform.
- `.netlify/features/netlify-identity`: Identity activation marker.

## Conventions

Use ES modules, descriptive variable names and snake_case SQL column names. Local TypeScript imports include `.js` extensions. Functions use `.mts` and Web Request/Response APIs. Preserve the existing theme and keep new UI responsive with meaningful loading, empty and error states. Escape all user-controlled strings before inserting HTML. Always protect server reads and writes independently of the browser navigation gate; never accept a caller-supplied owner ID for profile changes.

All persistent structured data belongs in Netlify Database. Binary profile images belong in Netlify Blobs; avatars use strong consistency because members expect newly saved images immediately. Local storage is permitted for non-sensitive interface preferences and the Identity SDK's own session handling, not for application profiles, scores or messages. Never store passwords in the application schema or return account email addresses in community responses.

## Non-obvious behavior

The Identity SDK's user confirmation field is `confirmedAt`; the installed SDK does not expose `emailVerified`. Only confirmed accounts can call the community API. Process email/recovery/invite callbacks on page load, and preserve password-setup screens until completion. Signup stores the selected server in Identity metadata, and the first authenticated request initializes the database profile once. Logout and account changes clear private UI and invalidate outstanding requests.

The `scores` table has no browser write endpoint. Official Garena ingestion is not connected. Zero scores and the waiting-for-results state are intentional, not a reason to add fake statistics. Ranking ties use join order and user ID. Today/week filters use UTC with Monday week boundaries. Shared chat is polling-based, not a websocket connection; the send rate limit uses a database transaction and a per-account advisory lock.

Generate schema changes using `drizzle-kit generate` into the configured migration directory. Never edit generated migrations that have been applied. Use `drizzle-orm@beta` and `drizzle-kit@beta` as required by the platform's native adapter instructions.

The platform handles build validation. Do not run builds, development servers, typecheckers or tests during agent implementation sessions unless subsequent explicit project instructions allow them. There is no existing automated test suite. Use the deployed end-to-end checklist in `README.md` for release verification.
