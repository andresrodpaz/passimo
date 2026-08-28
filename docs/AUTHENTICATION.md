# Authentication

Accounts, passwords and sessions belong to this application. There is no
third-party identity provider in the sign-in path.

Status: **implemented**. `tests/integration/auth-lifecycle.test.ts` and
`tests/unit/auth-password.test.ts` / `auth-session-token.test.ts` cover it.

---

## 1. Why it moved in-house

The product previously delegated accounts to a hosted auth service. Three
reasons that changed:

**A fresh database has to initialise from this repository alone.** With accounts
in a provider's schema, a restore produced a database full of businesses whose
owners did not exist — and `businesses.owner_id` referenced a table this repo
never migrated.

**Signup is one transaction or three failure modes.** It creates an account, a
workspace and an owner membership. Across a service boundary that is three calls
with hand-written compensating deletes, which is exactly what the old signup
route contained. In one database it is one sequence with one rollback path.

**"I can't sign in" is the highest-severity ticket a SaaS gets.** One place to
look beats two.

---

## 2. Accounts

`app_users`, created by `db/migrations/000000_identity.sql`.

- `email` is `citext` with a unique index, so `Ana@shop.com` and `ana@shop.com`
  are one account and two simultaneous signups resolve to one row and one 409
  rather than a read-then-write race both requests win.
- `status` is `active` | `suspended` | `deleted`. A suspended account fails
  sign-in and every existing session stops resolving.
- `failed_login_count` and `locked_until` are the per-account guessing control.
- Deleting a user cascades to sessions and tokens.

### Passwords

scrypt from Node's standard library — `N = 2^15, r = 8, p = 1`, 64-byte key,
16-byte random salt.

The choice is about deployment, not cryptography. This application ships as a
standalone Next.js bundle to Railway and to Docker, and a native addon
(`bcrypt`, `argon2`) is the single most common cause of "works locally, fails in
the container": mismatched glibc, no build toolchain in the runner stage, no
prebuilt binary for the platform. scrypt is memory-hard, is what NIST and OWASP
both list as acceptable, and has no build step.

Stored format is self-describing:

```
scrypt$32768$8$1$<salt base64>$<hash base64>
```

The parameters travel with the hash, so raising the cost factor later is a
one-line change that leaves every existing password verifiable — and
`needsRehash` upgrades them in place on the next successful sign-in, the only
moment the plaintext is in hand.

Policy is length, not composition: minimum 10 characters, maximum 200. Per NIST
800-63B, composition rules push people toward weaker, more predictable passwords.
The maximum is a denial-of-service control, not a security policy — scrypt's cost
is independent of input length, but hashing a 10 MB body on every attempt is not.

A corrupt or foreign hash returns `false` rather than throwing. A 500 on the
sign-in path would tell an attacker the row exists.

### Not disclosing which accounts exist

- Wrong password and unknown address both return `invalid_credentials`, and both
  take the same time: the no-such-user branch runs a real scrypt verification
  against a dummy hash, because identical copy with a 5 ms response is still an
  oracle.
- Password reset always reports success.
- `locked` and `suspended` *are* distinguishable, deliberately — the caller has
  already proven they know the address, and telling the legitimate owner why they
  cannot get in is worth more than the residual signal.

### Lockout

Five failures lock the account for fifteen minutes. Short enough that a merchant
who mistyped is not locked out of their own business for the evening; long enough
that an online attack against one account moves at twenty guesses an hour.

This sits *on top of* the route-level rate limit (8 attempts per five minutes per
IP). The two cover different axes: the rate limit stops one address hammering
many accounts, the lockout stops many addresses hammering one. A reset clears it,
so a locked-out owner has a way back in without waiting.

---

## 3. Sessions

Server-side. A session is a row in `user_sessions` plus a signed cookie carrying
its secret.

```
passimo_session = v1.<base64url payload>.<base64url hmac>
payload = { s: <session secret>, u: <user id>, e: <expiry, epoch seconds> }
```

Only `sha256(secret)` is stored, so a database dump contains no replayable
logins — the same reason `api_keys` stores hashes.

**Two checks, in this order.**

The **signature**, verified against `AUTH_SESSION_SECRET`, says "this cookie is
one of ours and has not expired". It costs nothing and needs no database, which
is what lets edge middleware make a redirect decision. `crypto.subtle.verify` is
constant-time, so there is no timing oracle to forge against a byte at a time.

The **database**, checked on every server-side authorisation, is authoritative on
everything the signature cannot know: revocation, the row's own expiry, and
whether the account is still active. A cookie that passes the first check and
fails the second gets a 401 from the API and a redirect from a page.

Middleware is therefore *optimistic by design*. It is a navigation concern —
keep signed-out visitors off the dashboard, keep signed-in ones off the login
form — and never the authorisation boundary. That lives in
`lib/auth/context.ts`.

### Why server-side rather than a self-contained token

Revocation is real. Signing out, changing a password, or an administrator
suspending an account all take effect on the next request. There is no window in
which a token outlives the decision to end it.

Sessions are also visible: `listSessions` can tell a merchant they are signed in
on three devices, and an operator investigating an incident can see when and from
where.

The cost is one indexed lookup per authenticated request, against a database the
process is already talking to — cheaper than the network round trip the previous
transport made for the same check.

### Lifetime

Absolute 30 days. `last_used_at` is touched at most once a day, so the device
list stays useful without writing on every request.

### Cookie flags

`httpOnly`, `path=/`, `secure` outside development (a secure cookie is silently
dropped over plain http, which would make local sign-in fail with no error
anywhere), `sameSite=lax`.

`lax`, not `strict`, because merchants arrive at the dashboard from links in
transactional email — a verification link, a reset link, a team invitation — and
`strict` would withhold the cookie on those top-level navigations and present a
signed-in user with a login form.

---

## 4. The three entry points

`resolveActor` in `lib/auth/context.ts`, in priority order:

| Credential | Actor | Used by |
| --- | --- | --- |
| `Authorization: Bearer psm_…` | `api_key`, scoped to one business | Integrations, partners |
| `Authorization: Bearer <session token>` | `user` | Native and mobile clients |
| `passimo_session` cookie | `user` | The dashboard and counter |
| `x-cron-secret` | `system` | Scheduled jobs and the worker |

Downstream code asks the actor for a *permission*, never for a role or a token,
so a new entry point never needs a new authorisation branch.

`fid_` is still accepted as an API-key prefix alongside `psm_`. Keys are stored
as SHA-256 hashes so the prefix is a routing hint rather than a credential — but
a key already pasted into a merchant's integration cannot be rewritten by us, and
dropping the old prefix would send it to the session path and fail it as "invalid
or expired" instead of authenticating it.

---

## 5. Flows

| Route | Purpose |
| --- | --- |
| `POST /api/v1/auth/signup` | Account + workspace + owner membership + provisioning, then a session |
| `POST /api/v1/auth/login` | Sign in; returns the workspace list so the client can route without a second request |
| `POST /api/v1/auth/logout` | Revoke this session, clear the cookie |
| `POST /api/v1/auth/password/reset-request` | Email a single-use link |
| `POST /api/v1/auth/password/reset` | Set a new password, revoke every session, mark the address verified, sign in |
| `POST /api/v1/auth/verify-email` | Confirm an address |
| `PUT /api/v1/auth/verify-email` | Re-send the confirmation |

Pages: `/login`, `/signup`, `/reset-password`, `/verify-email`.

### Signup unwinds

Every failure path deletes what it created. A half-provisioned tenant is worse
than no tenant, because the user cannot retry with the same email.

### Reset does three things, and all three matter

1. The password changes.
2. **Every other session is revoked.** A merchant resetting because they believe
   someone else is in their account has achieved nothing if that someone stays
   signed in.
3. The address is marked verified — receiving mail at it is the same proof the
   verification link asks for, so a second link would be friction for no gain.

Then a fresh session is created, so they land signed in rather than back at a
login form with a password they just typed twice.

### Single-use tokens

`user_tokens`, hashed, with a purpose (`password_reset` | `email_verification`)
and an expiry — one hour for a reset (a link in an inbox is a live credential),
three days for a confirmation (long enough to come back to it tomorrow).

Single use is enforced by `consumed_at is null` in the update that redeems one,
so two simultaneous clicks update one row and the loser gets nothing. Issuing a
new token consumes the account's outstanding ones of the same purpose — otherwise
"send me another link" leaves the previous one live, and a merchant who reset
because they suspected a compromise still has a valid link in a readable mailbox.

Purpose scoping means a reset link can never be replayed as a confirmation.

### Verification does not gate the product

A merchant who signs up at 9pm to set up a loyalty card before opening tomorrow
reaches their dashboard immediately. Blocking them behind an inbox round trip is
the most reliable way to lose them.

What verification gates is what needs a real address to be safe or useful:
outbound marketing from the account, billing notices, and password recovery.

Without `RESEND_API_KEY` the reset link is logged at `info` outside production —
so a developer can complete the flow — and never logged in production, never
returned to the client in any environment.

---

## 6. What is not implemented

Stated plainly rather than implied:

- **No OAuth / social sign-in.** No Google or Apple button. A merchant signs up
  with an email and a password.
- **No multi-factor authentication.** The highest-value item on the security
  roadmap. `user_sessions` and the token table are the shape it would build on.
- **No passkeys.**
- **No SSO / SCIM.** Not a need at this stage.
- **No session-management UI.** `listSessions` and `revokeAllSessions` exist and
  are tested; no settings screen calls them yet.
- **Impersonation** by platform staff is implemented, logged with a mandatory
  reason, and expires after an hour — see `lib/auth/platform-admin.ts`.

---

## 7. Secrets

| Variable | Rotating it |
| --- | --- |
| `AUTH_SESSION_SECRET` | Signs out every merchant on every device. The emergency control. |
| `APP_TOKEN_SECRET` | Invalidates outstanding wallet passes, card links, unsubscribe links and signed downloads. |

`AUTH_SESSION_SECRET` falls back to `APP_TOKEN_SECRET` when unset, so a small
deployment can run on one secret. Separate them in production: otherwise
rotating link signatures signs everybody out as a side effect.
