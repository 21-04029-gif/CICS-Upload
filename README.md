<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2f6ca112-61c9-47c0-bdbf-78874120c2d6

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, import the repository as a new project.
3. Use these project settings:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Add environment variables from [.env.example](.env.example):
   - `PAYMONGO_SECRET_KEY`
   - `APP_URL` (set to your Vercel production URL)
   - `FIREBASE_PROJECT_ID`
   - `FIRESTORE_DATABASE_ID` (if using a non-default database)
   - `FIREBASE_SERVICE_ACCOUNT_KEY` (recommended) or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
5. Redeploy after saving environment variables.

This project includes serverless API routes under [api/create-checkout-session.ts](api/create-checkout-session.ts), [api/verify-payment.ts](api/verify-payment.ts), [api/paymongo-webhook.ts](api/paymongo-webhook.ts), and [api/health.ts](api/health.ts) for Vercel.
