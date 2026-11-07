# Next.js Checkout-to-access example

A small Next.js application for working through the awkward moment between a successful Checkout and an app that still says unpaid. Try pending payment, confirmed access and a later hold. The protected page reads current server state; adding `?success=true` does not unlock it.

The local application is a teaching fixture with sample data. It runs without a Helpful Mod purchase, a Stripe account or an authentication provider. The separate `lib/funnel-client.mjs` adapter shows the calls to a purchased Funnel and Revenue service.

## Run it

Use Node.js 22.13 or later, then run:

```sh
npm ci
npm test
npm run dev
```

Open <http://127.0.0.1:3000>. Start the sample checkout, open the protected resource, simulate a confirmed payment and open it again. Simulate an access hold and confirm the resource is protected again. The fixture resets when its server process restarts. `npm run build` type-checks and builds the Next.js app; `npm start` serves that build on loopback.

This example pins Next.js 16.4.5 and React 19.3.1. The lockfile records the installed dependency versions.

## Connect your real application

The lab routes deliberately call `lib/lab.mjs`; they have no production mode. Integrate `lib/funnel-client.mjs` into your existing app's backend and replace the teaching routes. Keep the production auth, database and application design you already use.

The adapter takes these server-only dependencies:

```js
const funnel = createFunnelClient({
  origin: process.env.FUNNEL_ORIGIN,
  tenant: process.env.FUNNEL_TENANT_ID,
  offerId: "standard",
  signToken: claims => signToken(claims, process.env.HM_AUTH_SECRET),
});
```

Import `createFunnelClient` from this example. Supply `signToken` from your purchased Funnel package's `dist/core/auth.js` through your app's private server module. That helper imports the delivered runtime types and Zod; arrange the private package dependency in your build rather than copying its code into a public repository. Keep the signer out of Client Components. Use Next's `server-only` marker in your private wrapper.

The `session` argument is your authentication provider's verified server result, shaped as `{userId, email, emailVerified}`. The adapter refuses an unverified or missing session. Your own route must obtain that result afresh and must enforce its usual CSRF protections for mutations. Do not construct it from the request body.

Persist these records in your existing database:

| Record | Save | Read it for |
| --- | --- | --- |
| Customer mapping | Application user/installation, Funnel customer ID | Every customer command |
| Purchase attempt | User, configured offer, stable request key, returned checkout ID | Retrying Checkout and selecting its result |

Make the mapping unique for the application user and Funnel installation, and create the purchase attempt transactionally before queuing checkout. Your route finds both by the signed-in account. Never use browser-submitted ownership, price, offer or tenant values as authority. Keep a current pending attempt when the network response is uncertain, and retry the same key.

Available adapter methods:

```js
const customerId = await funnel.capture(session, actualConsentChoice);
const checkoutId = await funnel.startCheckout(session, customerId, savedRequestKey);
const checkout = await funnel.checkoutStatus(session, customerId, checkoutId);
const access = await funnel.access(session, customerId);
```

`startCheckout` queues work. Call `checkoutStatus` through your authenticated status route after the worker has run; a pending result has `ready: false` and no URL. The ready URL is checked against the saved Stripe Session. Do not log that URL. `access.allowed` requires current active access to the configured offer, and each service read uses `cache: "no-store"`.

Use `access` before returning paid data or running a paid operation. Handle an unavailable service as an unavailable access check with a retry option. The adapter throws for failed HTTP requests and malformed results rather than granting access. Your application decides how to present those errors without exposing private provider responses.

Run the purchased Funnel service and worker using its own README and `docs/INTEGRATION.md`. Set up your provider account and Snapshot destination at `/webhooks/stripe/funnel` following that package's Stripe instructions. In Funnel, runtime `mode: "live"` means provider transport; each offer's separate `livemode` value selects Stripe test or live resources. Start in your Stripe test mode and verify your own complete workflow.

## What the tests establish

The tests exercise the original adapter with controlled HTTP responses: verified identity claims, short token lifetime, stable retry payloads, queued checkout behavior, Stripe URL validation, offer-specific access, and errors that cannot become paid access. The local teaching app also exercises an access hold and same-origin mutation checks.

The tests use controlled HTTP responses and local sample data. The companion maintainer evidence records a contract check against Funnel 1.1.2 and an HTTP check of the built Next app. Use Stripe test mode to check the connection in your own application.

## Source and license

The original adapter, teaching app and tests are available under the [MIT license](LICENSE). The purchased Funnel service has its own commercial source license.

Read the [Next.js integration walkthrough](https://helpfulmods.com/blog/nextjs-stripe-checkout-paid-access/) or explore the [public MCP catalog](https://helpfulmods.com/llms.txt).

See [Funnel and Revenue](https://helpfulmods.com/mods/funnel/) for the durable customer, Checkout, reconciliation and access service used by the adapter.
