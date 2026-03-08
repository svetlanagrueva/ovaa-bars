# Bulgarian E-commerce Site

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/uD34lyOvSvi)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site](https://vercel.com/srgrueva-2029s-projects/v0-bulgarian-e-commerce-site)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/uD34lyOvSvi](https://v0.app/chat/uD34lyOvSvi)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository

## Setup
Supabase setup
1. Go to https://supabase.com and create a free project                                                                                                                       
2. Go to SQL Editor → paste the contents of supabase-schema.sql → click Run
3. Go to Project Settings → API and copy:
  - Project URL → paste into NEXT_PUBLIC_SUPABASE_URL in .env.local
  - service_role secret key → paste into SUPABASE_SERVICE_ROLE_KEY

Stripe setup
1. Go to https://dashboard.stripe.com/apikeys
2. Copy the Secret key (starts with sk_test_) → paste into STRIPE_SECRET_KEY

Run the app

```
nvm use 22
npm install
npm run dev
```

Tun tests - tests run fine in CI with Node 22
```
  nvm install 22                                            
  nvm use 22
  npx vitest run

```

Then open http://localhost:3000.