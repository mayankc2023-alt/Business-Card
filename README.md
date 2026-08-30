# Expo card scanner

Photograph business cards at an expo, get structured contacts (name, company,
title, phone, email, address, website), with one-tap WhatsApp and email
follow-up links, and CSV export for Excel.

## Local development

```
npm install
npm run dev
```

The frontend alone will run, but card extraction needs the API route, which
only works when deployed to Vercel (or run via `vercel dev` locally with the
Vercel CLI).

## Deploying

1. Push this folder to a GitHub repository.
2. Import the repository in Vercel (vercel.com -> Add New Project).
3. In the Vercel project's Settings -> Environment Variables, add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Deploy. Vercel will give you a URL like `your-project.vercel.app`.
5. Open that URL on a phone (iOS or Android) -- tapping the upload tiles
   opens the camera directly.

## Cost

Each card scan calls the Claude API once. At current pricing this is roughly
1-3 cents per card, so a 200-card expo costs on the order of a few dollars.
