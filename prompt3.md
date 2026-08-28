---

# APPLE WALLET & GOOGLE WALLET PROXIMITY FEATURES (MANDATORY)

The platform must fully support Apple Wallet and Google Wallet proximity features.

Even if developer credentials, certificates or production accounts are not yet available, the entire implementation must be prepared.

Implement every component except the final credential-dependent activation.

The project should become production-ready by simply adding the required credentials to the environment variables.

---

## Wallet Features

Support the following capabilities:

- Location-aware Wallet passes
- Nearby location suggestions
- Lock screen suggestions
- Wallet notifications
- Pass updates
- Dynamic pass content
- Beacon support (optional)
- GPS geofencing
- Merchant locations
- Multiple store locations
- Nearby offers
- Nearby rewards
- Automatic pass relevance

Design the architecture so these features can be enabled without refactoring.

---

## Environment Variables

Create every required environment variable.

Populate `.env.example`.

Add placeholders only.

Never hardcode secrets.

Examples include:

APPLE_TEAM_ID=

APPLE_PASS_TYPE_IDENTIFIER=

APPLE_WWDR_CERTIFICATE_PATH=

APPLE_SIGNING_CERTIFICATE_PATH=

APPLE_SIGNING_PRIVATE_KEY_PATH=

APPLE_SIGNING_KEY_PASSWORD=

APPLE_WALLET_ORGANIZATION_NAME=

APPLE_WALLET_WEB_SERVICE_URL=

APPLE_WALLET_AUTH_TOKEN=

GOOGLE_WALLET_ISSUER_ID=

GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL=

GOOGLE_WALLET_PRIVATE_KEY=

GOOGLE_WALLET_PROJECT_ID=

GOOGLE_MAPS_API_KEY=

GOOGLE_GEOCODING_API_KEY=

GOOGLE_PLACES_API_KEY=

GOOGLE_GEOFENCING_ENABLED=true

---

## Architecture

Implement:

- Wallet service abstraction
- Apple Wallet provider
- Google Wallet provider
- Geolocation service
- Store location service
- Pass update service
- Notification service
- Wallet synchronization service

Use dependency injection and clean architecture.

---

---

## Merchant Configuration (MANDATORY)

Every Wallet proximity feature must be fully configurable from the Merchant Dashboard.

Merchants must never need to modify code or contact support to change Wallet behavior.

The Admin Panel must provide a complete configuration interface.

Supported settings include:

### Store Locations

- Add unlimited store locations
- Edit locations
- Delete locations
- Set primary location
- Import locations
- Configure opening hours
- Configure location visibility

### Geofencing

Allow merchants to:

- Enable or disable geofencing
- Configure notification radius
- Configure multiple radiuses
- Configure different radiuses per location
- Configure entry-only triggers
- Configure exit triggers
- Configure dwell-time triggers

### Wallet Suggestions

Allow merchants to enable or disable:

- Apple Wallet lock screen suggestions
- Google Wallet suggestions
- Nearby Wallet recommendations
- Automatic Wallet updates
- Dynamic Wallet content
- Reward notifications
- Loyalty reminders

### Campaigns

Allow merchants to configure location-based campaigns.

Examples:

- Welcome notification
- Happy Hour
- Double Points
- Birthday Reward
- Weekend Promotion
- Lunch Promotion
- Coffee Morning
- VIP Event
- Seasonal Campaigns
- Custom Campaigns

Each campaign should support:

- start date
- end date
- weekdays
- start time
- end time
- specific locations
- customer segments
- loyalty tier
- minimum points
- minimum visits
- custom eligibility rules

### Notification Personalization

Merchants should be able to customize:

- Notification title
- Notification message
- Emoji
- Call-to-action
- Reward description
- Images
- Brand colors
- Logo
- Expiration date

Provide live preview whenever possible.

### Automation Rules

Allow merchants to create automation rules without coding.

Examples:

IF customer enters within 100 meters
THEN suggest Wallet card.

IF customer has enough points
THEN notify reward availability.

IF customer has not visited in 30 days
THEN show "Welcome Back" campaign.

IF customer birthday is today
THEN activate birthday reward.

IF customer is VIP
THEN show VIP campaign.

IF today is Happy Hour
THEN activate double points.

Provide an intuitive visual rule builder whenever possible.

### Analytics

Provide analytics for every proximity feature.

Track:

- Notification impressions
- Wallet suggestions
- Wallet opens
- Notification clicks
- Store visits
- Reward redemptions
- Campaign conversion rate
- Average visit delay after notification
- Revenue generated
- ROI per campaign

### Default Templates

Provide professionally designed templates for merchants.

Examples:

- Coffee Shop
- Bakery
- Restaurant
- Barber Shop
- Beauty Salon
- Gym
- Retail Store
- Pet Shop
- Pharmacy
- Supermarket

Merchants should be able to activate a complete Wallet strategy with just a few clicks.

---

## Product Principle

Every Wallet feature should be configurable from the Merchant Dashboard.

No feature should require editing source code.

No feature should require changing environment variables after deployment.

The only purpose of environment variables is to store provider credentials, certificates and infrastructure configuration.

Everything related to business behavior, campaigns, notifications, locations and customer experience must be managed through the Admin Panel.

Do NOT skip implementation because credentials are unavailable.

Implement every service.

Implement every model.

Implement every API.

Implement every configuration.

Implement every environment variable.

Implement every UI.

Implement every documentation page.

Leave only the final credential values empty.

The entire feature should become operational by simply filling the environment variables and deploying.

Whenever an external provider (Apple, Google, Stripe, Twilio, SendGrid, etc.) cannot be fully configured because credentials are unavailable, implement the complete integration architecture, configuration, services, UI and environment variables.

The only remaining step should be supplying valid credentials.

Never postpone an integration solely because secrets or certificates are missing.

# LANDING PAGE, DEMO DATA & SUBSCRIPTION SYSTEM (MANDATORY)

This section is mandatory.

The landing page must be redesigned to become a premium, modern, interactive and highly persuasive SaaS landing page.

The objective is to make the product feel like a world-class company comparable to Stripe, Shopify, Square or Linear.

## HONESTY & CREDIBILITY

The landing page must never display fake social proof.

Remove or replace immediately:

* “Businesses already using the platform”
* Fake customer counts
* Fake transaction numbers
* Fake revenue generated
* Fake testimonials
* Fake ratings
* Fake partner logos
* Any claim that cannot be verified

Until the product has launched, replace these sections with truthful alternatives such as:

* Join the early access program
* Be among the first businesses to launch
* Built for modern local businesses
* Designed for cafés, restaurants, retail stores, salons and gyms
* Launching soon
* Early adopter benefits

Never fabricate credibility.

## MULTILINGUAL CONSISTENCY

Fix the internationalization system completely.

The application must never mix Spanish and English on the same page.

Requirements:

* Every visible text must come from the translation system.
* No hardcoded strings.
* No mixed-language components.
* No untranslated placeholders.
* No English text when Spanish is selected.
* No Spanish text when English is selected.

Audit the entire repository and centralize all translations.

## LANDING PAGE REDESIGN

Completely redesign the landing page.

The new landing should include:

### Hero Section

* Premium visual design
* Animated gradient background
* Interactive Wallet card preview
* Live loyalty card mockup
* Dynamic QR demonstration
* Clear value proposition
* Strong CTA
* Secondary CTA

### Interactive Product Demo

Create an interactive section where visitors can:

* Add points
* Add stamps
* Unlock rewards
* Switch loyalty tiers
* Preview Apple Wallet
* Preview Google Wallet
* Preview merchant dashboard

### Merchant Dashboard Showcase

Create animated previews of:

* Customer management
* Loyalty campaigns
* Analytics
* QR scanning
* Wallet notifications
* Reward configuration

### Features Section

Use modern cards with icons and animations.

### Comparison Section

Show advantages versus:

* paper loyalty cards
* generic loyalty apps
* expensive enterprise solutions

### How It Works

Visual 3-step process:

1. Customer scans QR
2. Card is added to Wallet
3. Merchant scans and rewards automatically

### Pricing Section

Redesign completely.

Remove the free plan.

Plans should start at **$5/month**.

Implement a real subscription logic.

Suggested plans:

* Starter — $5
* Growth — $19
* Pro — $49
* Business — $99

Each plan must have meaningful feature limits.

## LANDING DEMO EXPERIENCE (MANDATORY)

The current landing page demo is too simple and does not demonstrate the value of the product.

Either redesign it completely or remove it entirely until a high-quality interactive demo is available.

A basic or incomplete demo damages trust and reduces conversion.

The demo must feel like a premium product experience.

Requirements:

* Fully interactive
* Realistic merchant dashboard
* Realistic customer experience
* Wallet card interaction
* QR scanning simulation
* Points and stamp accumulation
* Reward unlocking
* Live analytics preview
* Campaign creation preview
* Mobile and desktop previews
* Smooth animations and transitions
* Modern microinteractions
* High-end SaaS visual quality

If these standards cannot be achieved immediately, replace the demo with:

* a cinematic product walkthrough
* animated dashboard showcases
* interactive feature previews
* before/after merchant scenarios
* customer journey visualizations

Never keep a weak demo on the landing page.

Every landing page section should increase excitement, trust and perceived value.

## SUBSCRIPTION SYSTEM

Implement complete plan logic.

Every feature must be controlled by the subscription plan.

Examples:

### Starter ($5)

* 1 location
* basic loyalty
* QR scanner
* Wallet cards
* up to X customers

### Growth ($19)

* multiple locations
* campaigns
* analytics
* automation
* customer segmentation

### Pro ($49)

* AI features
* advanced analytics
* integrations
* custom branding
* API access

### Business ($99)

* unlimited locations
* unlimited customers
* advanced automations
* team management
* priority support
* enterprise features

Implement feature gating across the application.

The dashboard should adapt to the merchant’s plan.

## DEMO DATA (MANDATORY)

Create realistic demo data.

The application must feel alive immediately.

Create demo businesses such as:

* Madrid Coffee
* Barcelona Barber
* Valencia Fitness
* Sevilla Bakery

Create realistic customers.

Create transactions.

Create visits.

Create points.

Create rewards.

Create campaigns.

Create analytics.

Create Wallet passes.

Create QR history.

Create notifications.

## DEMO USERS (MANDATORY)

Create local development users.

Create one merchant account for each plan.

Examples:

* [starter@demo.com](mailto:starter@demo.com)
* [growth@demo.com](mailto:growth@demo.com)
* [pro@demo.com](mailto:pro@demo.com)
* [business@demo.com](mailto:business@demo.com)

Create realistic passwords for local development.

Each account should demonstrate the capabilities of its plan.

## ADMIN DEMO

Create a super admin account.

The admin should be able to:

* manage plans
* manage businesses
* impersonate merchants
* view platform analytics
* manage Wallet settings
* manage AI features
* manage subscriptions

## UI QUALITY

The entire application should feel premium.

Improve:

* spacing
* typography
* animations
* transitions
* loading states
* empty states
* microinteractions
* card design
* dashboard layout
* mobile responsiveness

Use modern SaaS design principles.

## FINAL GOAL

A visitor should see the landing page and immediately think:

“This looks like a premium product that could realistically become the leading loyalty platform for local businesses.”

Every design decision should increase conversion, trust and perceived value.
