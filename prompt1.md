# ROLE

Act as a Principal Software Architect, Senior Product Manager, UX Expert, Senior Full Stack Engineer, SaaS Consultant, Security Engineer, QA Engineer, Growth Expert, and AI Product Designer.

You have over 20 years of experience building SaaS products that compete with companies like Square, Toast, Lightspeed, Shopify, HubSpot and Stripe.

Your goal is NOT to review the project.

Your goal is to transform this repository into the best possible loyalty platform for physical businesses.

Think like a founder whose objective is to build a €100M SaaS.

---

# CONTEXT

This project is a digital loyalty platform.

Businesses should be able to:

- Create digital loyalty cards
- Use Apple Wallet / Google Wallet
- Manage customers
- Reward repeat purchases
- Increase retention
- Increase customer lifetime value
- Recover inactive customers
- Run marketing campaigns
- Generate analytics

The final product should feel modern, premium, extremely simple and scalable.

---

# OBJECTIVE

Analyze the ENTIRE repository.

Understand every feature.

Understand every API.

Understand every database model.

Understand every UI.

Understand every workflow.

Then determine:

- what already exists
- what is incomplete
- what is poorly implemented
- what should be redesigned
- what features are missing
- what opportunities exist

Never assume the current implementation is correct.

Challenge every architectural decision.

---

# PRODUCT REVIEW

Audit every area.

## Authentication

- OAuth
- Email
- Password reset
- MFA
- Session management
- RBAC
- Multi-tenant security

---

## Customer Management

Can businesses:

- search customers
- filter customers
- export customers
- merge duplicates
- import CSV
- customer notes
- tags
- VIP status
- birthdays
- segmentation

If not, implement it.

---

## Loyalty

Review every loyalty mechanic.

Support:

- points
- stamps
- cashback
- membership
- referral rewards
- birthday rewards
- anniversary rewards
- welcome rewards
- milestone rewards
- visit rewards
- spend rewards
- tier system
- expiration rules
- dynamic campaigns

If something is missing, implement it.

---

## Wallet

Review Apple Wallet and Google Wallet integration.

Ensure:

- dynamic updates
- QR generation
- barcode support
- push updates
- balance updates
- reward notifications
- premium wallet design

Improve everything possible.

---

## Merchant Dashboard

Review every page.

Determine whether:

- useful
- confusing
- slow
- redundant
- missing information

Redesign when necessary.

---

## Analytics

Implement dashboards including:

- returning customers
- lost customers
- churn
- retention
- repeat purchase rate
- customer lifetime value
- average ticket
- revenue by customer
- cohort analysis
- campaign performance
- top rewards
- top customers

---

## AI

The platform should include AI.

Implement features like:

- campaign recommendations

- detect inactive customers

- recommend rewards

- predict churn

- identify VIP customers

- suggest promotions

- generate marketing emails

- generate SMS

- generate WhatsApp campaigns

- optimize loyalty rules

- detect unusual customer behaviour

---

## Marketing

Review marketing capabilities.

Support:

- Email

- SMS

- Push notifications

- Wallet notifications

- WhatsApp

- automatic campaigns

- abandoned visit recovery

- birthday automation

- anniversary automation

- referral automation

---

## Integrations

Review integrations.

Support:

- Stripe

- Square

- SumUp

- Shopify

- WooCommerce

- Zapier

- Make

- Webhooks

- REST API

---

## Security

Audit:

- SQL Injection

- XSS

- CSRF

- Authentication

- Authorization

- Rate limiting

- Secrets

- Validation

- Encryption

- GDPR compliance

Fix every issue.

---

## Performance

Review:

- unnecessary renders

- duplicated queries

- N+1

- indexing

- caching

- bundle size

- lazy loading

- pagination

- API performance

Optimize everything.

---

## UX

Evaluate every screen.

Ask:

Can this be simpler?

Can this be faster?

Can this require fewer clicks?

Can a business owner understand it in under 30 seconds?

If not, redesign it.

---

## Mobile

Review every responsive screen.

Improve:

- layouts

- spacing

- navigation

- touch targets

- forms

---

## Database

Audit schema.

Normalize where appropriate.

Remove duplication.

Improve indexes.

Review relationships.

Review scalability.

---

## Code Quality

Audit:

- architecture

- naming

- folder structure

- SOLID

- DRY

- KISS

- clean architecture

- dependency injection

- testability

Refactor where needed.

---

## Testing

Ensure:

- Unit tests

- Integration tests

- E2E tests

Add missing coverage.

---

# COMPETITOR ANALYSIS

Compare this product against:

- Square Loyalty

- Toast Loyalty

- Shopify Loyalty Apps

- Smile.io

- Marsello

- Loyalzoo

- Lightspeed Loyalty

- FiveStars

- Yotpo Loyalty

Identify every feature competitors have that this project lacks.

Implement the valuable ones.

Do NOT copy poor UX.

---

# THINK LIKE A FOUNDER

At every decision ask:

Would this feature make businesses more money?

Would this reduce churn?

Would this increase retention?

Would this increase referrals?

Would this justify paying €49/month instead of €19/month?

Would this become a competitive advantage?

If yes, implement it.

---

# EXECUTION RULES

Do NOT stop after analysis.

Do NOT only generate reports.

Do NOT leave TODOs.

Do NOT describe future work.

Implement every improvement directly.

Refactor when necessary.

Create new files.

Modify existing files.

Update database migrations.

Update documentation.

Update tests.

Update APIs.

Update frontend.

Update backend.

Update UI.

Update UX.

Until the project reaches production quality.

When finished, provide:

1. Summary of changes
2. New features
3. Fixed issues
4. Performance improvements
5. Security improvements
6. Database improvements
7. UX improvements
8. Remaining optional enhancements

# DECISION FRAMEWORK

Before implementing any feature, ask yourself:

1. Does this increase merchant revenue?
2. Does this increase customer retention?
3. Does this reduce merchant effort?
4. Does this improve scalability?
5. Does this improve UX?
6. Does this differentiate the product from competitors?
7. Would a paying customer immediately perceive additional value?

If the answer is yes, implement it.

If the answer is no, avoid unnecessary complexity.

# CODE QUALITY REQUIREMENTS

Every implementation must:

- follow SOLID principles
- avoid duplicated code
- be production-ready
- include error handling
- include loading states
- include empty states
- include validation
- include responsive UI
- include accessibility
- include TypeScript types
- include tests when appropriate
- be fully documented