# FireVerso

FireVerso is an independent Free Fire community website. This project preserves the supplied site's nickname, symbol, bio and sensitivity tools and adds real accounts, persistent community profiles, a members-only leaderboard and shared chat rooms.

## Technologies

The frontend uses HTML, CSS, JavaScript and Vite. Netlify Identity manages Google/Facebook sign-in, optional email accounts, email confirmation, account recovery and sessions. A Netlify Function checks authentication and player setup before reading or changing community data. Netlify Database stores profiles, Free Fire IDs, score records and messages using Drizzle ORM; Netlify Blobs stores profile images.

## Local development

Install dependencies with `npm install`, link the directory to the Netlify project, then run `netlify dev --port 8889`. Netlify's local development environment is required to provide Identity, Functions, Database and Blobs integration; running Vite alone does not emulate these services. Do not place credentials in source files.

The deployment pipeline runs the configured Vite build, publishes `dist`, deploys the function, enables Identity using `.netlify/features/netlify-identity`, and applies generated database migrations. Registration must remain open in the site's Identity settings for email signup. Confirmed accounts are required by the community API, so production email delivery and confirmation redirects must be configured for the deployed domain.

### Sign-in provider setup

Enable Google and Facebook in the Netlify project's **Identity > External providers** settings and configure the provider application credentials and callback URLs there. Do not put provider secrets in this repository. The sign-in page checks the public Identity settings and only enables configured providers. Loading failures show a retry option rather than sending users to a broken OAuth redirect.

The installed Netlify Identity SDK supports Google and Facebook but **does not support Discord**. Discord is clearly marked unavailable; adding it requires a separately configured authentication integration, not a cosmetic button or an unverified player-ID login. Google and Facebook sign-in do not require a separate FireVerso email or password form. Providers may still share an email with Identity internally. The optional email path remains the existing email/password flow, including confirmation, recovery and invitation callbacks; it is not passwordless email sign-in.

## Joining and rankings

Visitors can see the introduction but must sign in before using community features or tools. Social sign-in is the default screen, with optional email sign-in behind a separate button. After authentication, player setup asks for **only a Free Fire player name and numeric Free Fire ID**. The initial profile is created idempotently on the first authenticated API request. The Free Fire ID is stored as text to preserve its digits, including leading zeroes, and is shown only on the member's own profile. It is self-reported: no Garena verification or account linking is implied, and it is never used as a login credential.

Existing profiles retain their names, scores, messages and other details. Members whose profiles do not yet have a Free Fire ID complete the same two-field setup on their next sign-in. The API independently requires setup before allowing leaderboard, members, chat or avatar access, and incomplete profiles do not appear in member lists or rankings. Ownership continues to use the authenticated Identity account, not a submitted player ID. Signed-in members can edit their profile, upload a photo, search the leaderboard and join chat rooms. Email addresses and passwords are never returned in leaderboard or chat responses.

The leaderboard uses persisted score records, not random demo statistics. New members appear with zero scores. Scores cannot be edited by browser clients. **An official Garena match-data import or trusted score-entry workflow is not included**, because none was provided with the original site. Until such a source is connected, all game scores remain zero. Future trusted score ingestion must validate nonnegative statistics, wins not exceeding matches, duplicate match prevention and authorization. Equal scores are ordered by profile creation time, then user ID. Today and this-week filters use UTC; weeks begin on Monday.

Leaderboard pages contain 30 players. The first page refreshes every 15 seconds while visible; after loading more pages, use the refresh button to refresh the list. Chat rooms refresh every 10 seconds while visible, display the latest 60 messages, and enforce a server-side two-second sending interval. Messages are shared between accounts and are not stored in device-only JSON.

## Release checklist

Local builds, development servers and tests were not run in the implementation session; deployment validation is handled by the platform. Before announcing the site, complete an end-to-end check on the deployed preview: enable and sign in through both Google and Facebook; verify unconfigured providers remain disabled and Discord is marked unavailable; create two email accounts and follow their confirmation emails; complete the name/ID setup; verify both appear on the leaderboard; change a server, player name and ID; send messages between accounts; upload a photo; sign out; reload protected URLs; follow a password recovery email; and accept an invitation. Check that leading zeroes survive ID saving, invalid IDs are rejected by the server, existing member data is retained, incomplete accounts cannot call community endpoints, and signed-out requests return an authentication error. Confirm that provider, recovery and invite callbacks keep the correct setup screen and that email and Free Fire IDs are absent from leaderboard/chat responses.

The supplied site's unavailable game-ID, HUD, item-catalog and guild-listing placeholders were removed from navigation rather than presented as working integrations. FireVerso is not affiliated with Garena.
