# IronPulse · Healthy Lifestyle Tracker

Live app: https://asaeed-87.github.io/ironpulse/

## Upload / update
1. In the `ironpulse` repository: **Add file → Upload files**.
2. Drag in **everything in this folder** (index.html, sync.js, sw.js, manifest.webmanifest, .nojekyll, firestore.rules, README.md and the `icons` folder).
3. **Commit changes**. The site updates within 1–5 minutes.
4. For future updates, change `VERSION` in `sw.js` (e.g. `ironpulse-v17`) so phones fetch the new version.

## Firebase (project `ironpulsedb`)
- Authentication → Sign-in method: **Google** and **Email/Password** enabled.
- Authentication → Settings → Authorized domains: **asaeed-87.github.io**.
- Firestore → Rules: contents of `firestore.rules`.

Your data is stored in Firestore under `users/<your-uid>/docs/…` and is readable only by you. Never upload backup `.json` files to this repository — it is public.
