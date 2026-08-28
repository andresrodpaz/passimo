/**
 * English — the reference dictionary.
 *
 * This object's *shape* is the contract. `Dictionary` is derived from it, so every
 * other locale is type-checked against it: a missing Spanish key is a build error,
 * not a page that silently renders half in English. That mechanism is the whole
 * reason the translation system was rebuilt — "no mixed languages" cannot be a
 * convention, because conventions are exactly what a growing UI breaks.
 *
 * Conventions:
 *   * Keys are dotted namespaces mirroring where the string appears.
 *   * `{placeholders}` are interpolated by `t(key, { placeholder })`.
 *   * A key ending `_one` / `_other` is a plural pair, selected by `count`.
 *   * No sentence is assembled from fragments in a component. Word order differs
 *     between languages, and concatenation is how "3 puntos restantes" becomes
 *     "restantes 3 puntos".
 */

export const en = {
  common: {
    appName: 'Passimo',
    tagline: 'The digital loyalty platform for local businesses',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    remove: 'Remove',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    search: 'Search',
    loading: 'Loading…',
    retry: 'Try again',
    optional: 'Optional',
    required: 'Required',
    enabled: 'On',
    disabled: 'Off',
    active: 'Active',
    inactive: 'Inactive',
    paused: 'Paused',
    draft: 'Draft',
    all: 'All',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    perMonth: '/month',
    perYear: '/year',
    metres: '{value} m',
    kilometres: '{value} km',
    minutes_one: '{count} minute',
    minutes_other: '{count} minutes',
    hours_one: '{count} hour',
    hours_other: '{count} hours',
    days_one: '{count} day',
    days_other: '{count} days',
    somethingWentWrong: 'Something went wrong',
    tryAgainOrContact: 'Try again, or contact us if it keeps happening.',
    comingSoon: 'Coming soon',
    learnMore: 'Learn more',
    preview: 'Preview',
    upgradeRequired: 'Upgrade required',
    upgradeToUse: 'Available from {plan}',
    language: 'Language',
    theme: 'Theme',
    copy: 'Copy',
    copied: 'Copied',
    clear: 'Clear',
    dismiss: 'Dismiss',
    open: 'Open',
    status: 'Status',
    previous: 'Previous',
    never: 'Never',
    ready: 'Ready',
    notConfigured: 'Not configured',
    couldNotSave: 'We could not save that',
    saveChanges: 'Save changes',
    downloadForPrint: 'Download for print',
    archived: 'Archived',
    anonymous: 'Anonymous',
    seeAll: 'See all',
  },

  nav: {
    features: 'Features',
    howItWorks: 'How it works',
    pricing: 'Pricing',
    compare: 'Compare',
    demo: 'Live demo',
    wallet: 'The card',
    login: 'Log in',
    getStarted: 'Start free trial',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },

  /**
   * Onboarding — three required steps, and nothing else.
   *
   * The business itself was created at signup (name, trade, time zone), so the
   * wizard asks only for what a merchant cannot serve a customer without: a plan,
   * a place, and a card. Everything the old flow asked for here now lives in the
   * dashboard checklist, where it can be done later or never.
   */
  onboarding: {
    progressLabel: 'Setup progress',
    progressTitle: 'Your loyalty program',
    progressPercent: '{percent}% done',
    saveFailed: 'We could not save that. Please try again.',
    steps: {
      program: 'Your program',
      plan: 'Your plan',
      shop: 'Your shop',
      location: 'Your shop',
      card: 'Your card',
    },
    units: {
      stamp: 'stamp',
      stamps: 'stamps',
      point: 'point',
      points: 'points',
    },
    program: {
      title: 'Here is your program, {businessName}',
      subtitle:
        'Built from the kind of business you run. Everything below is a starting point — change any of it now or later.',
      programName: '{business} rewards',
      rowProgram: 'How they earn',
      rowReward: 'What they get',
      rowCampaign: 'Your first campaign',
      stampsSummary: 'A stamp per visit, {goal} stamps to a reward',
      pointsSummary: 'A point per unit spent, {goal} points to a reward',
      notYourTrade: 'Not quite right?',
      notYourTradeHint: 'Pick the closest one and everything above updates.',
      continue: 'This looks right',
      /* The first campaign that pays for itself in each trade. Concrete, because
         "run a campaign" means nothing to someone who has never run one. */
      campaigns: {
        cafe: 'Double stamps before 10am, to build the morning habit',
        restaurant: 'A birthday dessert, sent the week before',
        bakery: 'A “fresh out of the oven” alert for regulars nearby',
        barber: 'A nudge at four weeks, when a cut is due',
        beauty: 'A treat for anyone who has not booked in two months',
        gym: 'A milestone reward at ten visits, when habits stick',
        retail: 'An early look at the sale, for members only',
        bar: 'A round on the house after eight visits',
        pet: 'A reminder when the food they buy runs out',
        other: 'A welcome-back offer after thirty quiet days',
      },
    },
    plan: {
      title: 'Pick a plan, {businessName}',
      subtitle:
        'Every plan includes a 14-day trial with everything unlocked, and no card is needed to start.',
      continueTrial: 'Start my 14-day trial',
      continueTrialHint:
        'You are on the trial already. Choose a plan whenever you are ready — nothing stops working today.',
      choose: 'Choose {plan}',
      chosen: 'Chosen',
      recommended: 'Recommended for you',
      notConfigured:
        'Online checkout is not set up on this deployment, so your trial simply continues. You can change plans from the billing screen at any time.',
    },
    location: {
      title: 'Where do customers find you?',
      subtitle:
        'One shop is enough to start. This is what a card points at, and what a geofence is measured from later.',
      nameHint: 'What your customers call it — the sign above the door.',
      addressHint:
        'Coordinates are optional now. Add them later and proximity notifications switch on.',
      skipCoordinates: 'I will add the exact location later',
      skip: 'Skip this — I will add my shop later',
      createFailed: 'We could not save your shop. Please try again.',
    },
    /**
   * The public enrolment page — the single conversion point of the product.
   *
   * Every one of these was a hardcoded English literal until this pass, which
   * meant a Spanish cafe's customers scanned a QR code at the counter and got an
   * English form. It is the highest-traffic customer-facing screen there is.
   */
  card: {
      title: 'Activate your loyalty card',
      subtitle:
        'We have prefilled a reward and colours that suit your trade. Change them or accept them — either way, it goes live now.',
      colours: 'Colours',
      reward: 'What do they earn?',
      rewardPlaceholder: 'A free coffee',
      goal: 'How many stamps to earn it?',
      goalHint:
        'A regular who visits weekly reaches {goal} in about {goal} weeks. Under six weeks keeps people engaged.',
      goalPoints: 'How many points to earn it?',
      goalPointsHint:
        'Roughly one point per unit spent, so {goal} points is a customer who has spent that much with you.',
      moreLater:
        'Templates, typography, the back of the card and everything it shows are in the card designer, whenever you want them.',
      activate: 'Activate the card',
    },
    ready: {
      title: 'Your loyalty program is live',
      subtitle:
        'Your card is ready, your reward is set, and the campaigns below are already running. Put the code on the counter and start accepting customers.',
      qrTitle: 'Your sign-up code',
      qrBody:
        'Print it and put it by the till. Customers scan it, enter their email, and the card is on their phone.',
      qrAlt: 'QR code for customers to join',
      running: 'Already running for you',
      bullets: {
        reward: 'Your reward: {reward}',
        welcome: 'A welcome message when someone joins',
        birthday: 'A gift on their birthday',
        winback: 'A win-back offer after 30 quiet days',
        rewardReady: '“Your reward is ready” the moment they qualify',
      },
      nextTitle: 'When you have a minute',
      next: {
        location: 'Add your address so cards show where to find you',
        campaigns: 'Turn on a campaign for your trade',
        design: 'Fine-tune the card in the designer',
      },
      openScanner: 'Start accepting customers',
      goToDashboard: 'Explore my dashboard',
      laterNote:
        'The rest — other shops, proximity, campaigns — is waiting on your dashboard as a checklist. None of it blocks the counter.',
    },
    presets: {
      cafe: 'A free coffee',
      bakery: 'A free pastry',
      restaurant: 'A free dessert',
      bar: 'A drink on us',
      barber: 'A free cut',
      beauty: 'A free treatment',
      gym: 'A free class',
      retail: 'A reward on us',
      pet: 'A free treat for them',
      other: 'A reward on us',
    },
  },

  landing: {
    hero: {
      badge: 'Location-aware wallet passes are live',
      titleLead: 'Loyalty that lives',
      titleAccent: 'on the lock screen',
      subtitle:
        'Digital loyalty cards in Apple Wallet and Google Wallet. Customers scan a QR code and they are in — no app to download. When they walk past your door, their card comes back to them.',
      ctaPrimary: 'Start your 14-day trial',
      ctaSecondary: 'Try the live demo',
      noCard: 'No card required · Set up in ten minutes · From {price}/month',
      founderPricing: 'Founder pricing for early merchants',
    },
    trust: {
      title: 'Built for modern local businesses',
      subtitle:
        'Designed for cafés, restaurants, retail stores, salons and gyms. We are opening early access now — be among the first to launch.',
      earlyAccess: 'Join the early access programme',
      earlyAccessBody:
        'We are onboarding our first businesses. Early adopters get founder pricing for life, direct access to the team, and a say in what we build next.',
      launching: 'Launching soon',
      builtFor: 'Made for',
      launchInOneSession: 'Launch in one session',
      launchInOneSessionBody: 'Set up your card, QR and first reward in minutes.',
      noAppRequired: 'No app required',
      noAppRequiredBody: 'Customers use Apple Wallet or Google Wallet with no download.',
      builtForDailyUse: 'Built for daily use',
      builtForDailyUseBody: 'The scanner, wallet pass and campaigns all work from the same system.',
      segments: {
        cafe: 'Cafés & coffee shops',
        restaurant: 'Restaurants & bars',
        retail: 'Retail stores',
        salon: 'Salons & barbers',
        gym: 'Gyms & studios',
        bakery: 'Bakeries',
      },
    },
    /**
     * The interactive demo.
     *
     * No camera vocabulary anywhere in here, deliberately. The demo shows the
     * loyalty loop — a regular returns, the balance moves, the reward unlocks,
     * the card updates — and never asks a desktop visitor to think about a
     * scanner they cannot use. The one mention of scanning is `scannerNote`,
     * which says plainly where the real scanner lives.
     */
    demo: {
      title: 'The whole product, in your browser',
      subtitle:
        'This is not a video. Record a visit, watch the balance move, unlock a reward and see the card in your customer’s pocket update — all without a camera, an account or a download.',
      tabCounter: 'At the counter',
      tabWallet: 'Their wallet card',
      tabNearby: 'When they walk past',
      tabMerchant: 'Your dashboard',
      counterBody:
        'A regular walks in. This is what your team sees, and the one action they take.',
      walletBody:
        'The same card, in both wallets. Change the trade or the colour and watch it follow.',
      merchantBody: 'Every visit lands here the moment it happens.',
      programName: '{business} rewards',
      sampleLocation: 'Calle Mayor 12',
      memberSince: 'March',
      memberSinceLine: 'Member since {since}',
      simulateVisit: 'Record a visit',
      recording: 'Recording…',
      points: 'Points',
      nextReward: 'Next reward',
      readyNow: 'Ready now',
      pointsAway: '{count} points away',
      redeem: 'Redeem reward',
      reset: 'Start over',
      rewardUnlocked: 'Reward unlocked',
      rewardUnlockedBody: '{name} has earned {reward}. It is waiting on her card.',
      stampsToGo_one: '{count} stamp to go',
      stampsToGo_other: '{count} stamps to go',
      flow: {
        visit: '{name} is served',
        credited: 'A stamp and {points} points are credited',
        reward: 'Her reward unlocks',
        wallet: 'The card in her pocket updates',
      },
      scannerNote:
        'In the real product this starts with a scan — the camera lives in your dashboard and on your phone, not on this page.',
      sampleDataNote: 'Sample data, real interface. No figures on this page describe real usage.',
      previewDisclaimer:
        'A preview of the design. The pass itself is issued by Apple and Google.',
      customiseTrade: 'Try another trade',
      customiseColour: 'Try another colour',
      tierLabel: 'Tier',
      tiers: { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' },
      lockScreen: 'Lock screen',
      distanceLabel: 'She is {distance} away',
      outsideRadius: 'Nothing shows until she is within {distance}.',
      nearbyReady: 'Your {reward} is waiting for you.',
      nearbyPassing: 'You are near {business} — your card is ready.',
      merchantToday: 'Today',
      merchantVisits: 'Visits',
      merchantNewMembers: 'New members',
      merchantRewards: 'Rewards given',
      merchantRevenue: 'Attributed revenue',
      campaignTitle: 'Proximity campaign',
      campaignBody: 'Morning coffee · within 150 m · weekdays 07:00–10:30',
      liveNote: 'Sample data, real interface.',
    },
    /**
     * The wallet section — the strongest section on the page, because the card
     * is the product.
     */
    wallet: {
      title: 'A card that lives where your customer already looks',
      subtitle:
        'Apple Wallet and Google Wallet lay a pass out differently. Here is yours in both, and here is what changing your brand does to it.',
      pickTrade: 'Pick a trade',
      pickColour: 'Pick a colour',
      previewNote:
        'These are previews of the design, rendered by us. The pass itself is generated and signed by Apple and Google.',
      noApp: 'No app to install',
      noAppBody: 'Customers add the card to the wallet already on their phone.',
      live: 'Always up to date',
      liveBody: 'Balance, tier and rewards are pushed to the card as they change.',
      notify: 'Comes back on the lock screen',
      notifyBody: 'A card that reappears when a customer is near your door.',
      yours: 'Yours, not ours',
      yoursBody: 'Eleven templates, your colours, your logo and your words on the back.',
    },
    features: {
      title: 'Everything a local business needs, and nothing it does not',
      subtitle:
        'One system for the card, the counter, the campaigns and the numbers behind them.',
      wallet: {
        title: 'Apple & Google Wallet',
        body: 'The card lives in the wallet app they already have. Nothing to download, nothing to lose.',
      },
      proximity: {
        title: 'Comes back when they are near',
        body: 'Set a radius per store and the card surfaces on the lock screen as they walk past. Entry, exit or dwell.',
      },
      scanner: {
        title: 'Scanner built in',
        body: 'Any phone, tablet or laptop with a camera. No hardware to buy, no terminal to lease.',
      },
      campaigns: {
        title: 'Campaigns that run themselves',
        body: 'Happy hour, birthdays, win-back. Set the rule once and it earns every week without you.',
      },
      analytics: {
        title: 'Numbers you can act on',
        body: 'Which campaign brought people in, how long after the notification, and what it was worth.',
      },
      multiLocation: {
        title: 'Every location, one account',
        body: 'Per-site radiuses, opening hours and reporting. Add a store and every card updates.',
      },
    },
    howItWorks: {
      title: 'Three steps, ten minutes',
      subtitle: 'From signing up to a customer holding your card.',
      step1: { title: 'The customer scans your QR code', body: 'On the counter, on the receipt, in the window. No app store, no forms.' },
      step2: { title: 'The card lands in their wallet', body: 'Apple Wallet or Google Wallet, with your logo and your colours.' },
      step3: { title: 'You scan, they are rewarded', body: 'Point any camera at their card. Points, tier and rewards update instantly.' },
    },
    compare: {
      title: 'Why not the alternatives',
      subtitle: 'The honest version.',
      us: 'Passimo',
      paper: 'Paper stamp cards',
      genericApp: 'Generic loyalty apps',
      enterprise: 'Enterprise platforms',
      rows: {
        cost: 'Monthly cost',
        costUs: 'From {price}',
        costPaper: 'Printing, forever',
        costApp: '{price} and up',
        costEnterprise: 'Thousands, plus setup',
        install: 'Customer has to install an app',
        knowsCustomers: 'You know who your customers are',
        proximity: 'Comes back when they walk past',
        hardware: 'Needs special hardware',
        lost: 'Card gets lost',
        setup: 'Time to go live',
        setupUs: 'Ten minutes',
        setupPaper: 'A trip to the printer',
        setupApp: 'Days',
        setupEnterprise: 'Weeks, with a project manager',
      },
    },
    dashboardShowcase: {
      title: 'What you will actually be using',
      subtitle: 'The merchant side, built for someone standing behind a counter.',
      customers: { title: 'Customers', body: 'Every visit, every reward, every note — in one profile.' },
      campaigns: { title: 'Campaigns', body: 'Write it once, choose who and when, and leave it running.' },
      analytics: { title: 'Analytics', body: 'Retention, cohorts, and the revenue each campaign brought in.' },
      scanner: { title: 'Counter scanner', body: 'Camera opens instantly and stays open. Works offline.' },
      wallet: { title: 'Wallet & geofencing', body: 'Radius, triggers and copy — per store, no code.' },
      rewards: { title: 'Rewards', body: 'Stamps, points, tiers and gift cards from one screen.' },
    },
    pricing: {
      title: 'Simple pricing that pays for itself',
      subtitle: 'Every plan includes the wallet cards, the scanner and a 14-day trial with everything unlocked.',
      monthly: 'Monthly',
      yearly: 'Yearly',
      yearlyNote: 'Two months free',
      popular: 'Most popular',
      cta: 'Start free trial',
      ctaCurrent: 'Your current plan',
      perMonth: '/month',
      billedYearly: 'billed yearly',
      trialNote: 'Fourteen days, everything unlocked, no card required. Cancel in one click.',
      includesEverything: 'Everything in {plan}, plus:',
      customersLabel: 'Customers',
      locationsLabel: 'Locations',
      limitCustomers_one: '{count} customer',
      limitCustomers_other: '{count} customers',
      limitCustomersUnlimited: 'Unlimited customers',
      limitLocations_one: '{count} location',
      limitLocations_other: '{count} locations',
      limitLocationsUnlimited: 'Unlimited locations',
    },
    cta: {
      title: 'Your customers already have a wallet. Be in it.',
      subtitle: 'Set up your card, print one QR code, and start recognising the people who keep coming back.',
      button: 'Start your 14-day trial',
      note: 'No card required. Ten minutes to your first stamp.',
    },
    footer: {
      product: 'Product',
      company: 'Company',
      legal: 'Legal',
      features: 'Features',
      pricing: 'Pricing',
      demo: 'Live demo',
      docs: 'Documentation',
      about: 'About',
      contact: 'Contact',
      earlyAccess: 'Early access',
      privacy: 'Privacy',
      terms: 'Terms',
      cookies: 'Cookies',
      rights: 'All rights reserved.',
      builtIn: 'Built for local businesses.',
    },
  },

  auth: {
    login: {
      title: 'Welcome back',
      subtitle: 'Sign in to your dashboard.',
      email: 'Email',
      password: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      noAccount: 'No account yet?',
      signUp: 'Start a free trial',
      forgot: 'Forgot your password?',
      failed: 'That email and password do not match.',
      unreachable: 'We could not reach the server. Check your connection and try again.',
      resetNeedsEmail: 'Enter your email first, then choose "Forgot your password".',
      resetSent: 'If an account exists for {email}, a reset link is on its way.',
      emailPlaceholder: 'you@yourbusiness.com',
      tooMany: 'Too many attempts. Wait a few minutes and try again.',
    },
    reset: {
      title: 'Choose a new password',
      subtitle: 'Then you will be signed straight in.',
      newPassword: 'New password',
      confirmPassword: 'Repeat it',
      hint: 'At least 10 characters. A short phrase you will remember beats a complicated word.',
      submit: 'Save and sign in',
      submitting: 'Saving…',
      tooShort: 'Please choose a longer password — at least 10 characters.',
      mismatch: 'Those two passwords do not match.',
      failed: 'We could not change your password. Request a new link and try again.',
      done: 'Password changed',
      doneHelp: 'We signed you out everywhere else. Taking you to your dashboard…',
      noToken: 'This page needs a link from your email',
      noTokenHelp:
        'Open the "Reset your password" email we sent you and use the button inside it.',
      backToLogin: 'Back to sign in',
    },
    verify: {
      working: 'Confirming your email…',
      done: 'Email confirmed',
      doneHelp: 'Campaigns, billing notices and password recovery are all live now.',
      toDashboard: 'Go to my dashboard',
      failed: 'We could not confirm this link',
      failedHelp:
        'Confirmation links expire after three days and work once. Request a new one from Settings.',
      resend: 'Send a new link',
    },
    /** Copy for the two account emails Passimo sends on its own behalf. */
    emails: {
      passwordReset: {
        subject: 'Reset your Passimo password',
        body:
          'Someone asked to reset the password for this Passimo account. ' +
          'Use the button below within the next hour to choose a new one. ' +
          'If it was not you, you can ignore this email — nothing has changed.',
        cta: 'Choose a new password',
      },
      verify: {
        subject: 'Confirm your email for Passimo',
        body:
          'Welcome to Passimo. Confirming your email switches on campaigns, billing notices ' +
          'and password recovery for your account. Your dashboard already works — this just ' +
          'unlocks everything that needs to reach you by email.',
        cta: 'Confirm my email',
      },
    },
    signup: {
      title: 'Start your free trial',
      subtitle: 'Fourteen days, everything unlocked, no card required.',
      businessName: 'Business name',
      email: 'Email',
      password: 'Password',
      submit: 'Create my account',
      submitting: 'Creating your account…',
      hasAccount: 'Already have an account?',
      login: 'Sign in',
      passwordWeak: 'Use at least 10 characters, with a number and a letter.',
      terms: 'By continuing you accept our terms and privacy policy.',
      businessNamePlaceholder: 'The Daily Grind',
      emailPlaceholder: 'you@yourbusiness.com',
      passwordPlaceholder: 'At least 10 characters',
      categoryLabel: 'What kind of business?',
      needsBusinessName: 'What is your business called?',
      badEmail: 'That email address does not look right.',
      passwordTooShort: 'Please choose a longer password — at least 10 characters.',
      passwordTooSimple: 'That password is too easy to guess. Try adding a few more words.',
      failed: 'We could not create your account. Please try again.',
      strength: { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' },
      perks: {
        wallet: 'Digital cards for Apple & Google Wallet',
        automations: 'Automatic birthday and win-back campaigns',
        fast: 'Set up in under 5 minutes',
      },
      categories: {
        cafe: 'Café / coffee shop',
        bakery: 'Bakery',
        restaurant: 'Restaurant',
        bar: 'Bar',
        barber: 'Barber shop',
        beauty: 'Beauty & spa',
        gym: 'Gym & fitness',
        retail: 'Retail & boutique',
        pet: 'Pet store',
        other: 'Something else',
      },
    },
  },

  dashboard: {
    nav: {
      today: 'Today',
      sell: 'Sell',
      grow: 'Grow',
      understand: 'Understand',
      configure: 'Configure',
      overview: 'Overview',
      pointOfSale: 'Point of sale',
      customers: 'Customers',
      rewards: 'Rewards',
      giftCards: 'Gift cards',
      memberships: 'Memberships',
      campaigns: 'Campaigns',
      automations: 'Automations',
      growth: 'Referrals & reviews',
      network: 'Partner network',
      analytics: 'Analytics',
      insights: 'AI insights',
      locations: 'Locations',
      wallet: 'Wallet & proximity',
      settings: 'Settings',
      billing: 'Plan & billing',
      admin: 'Admin console',
      signOut: 'Sign out',
      yourBusinesses: 'Your businesses',
      scan: 'Scan',
      lockedHint: 'Available on a higher plan',
    },
    lapsed: {
      title: 'Your subscription is inactive',
      body: 'Nothing has been deleted — every customer, card and campaign is still here. Reactivate to start serving again.',
      cta: 'Reactivate from {price}/month',
    },
    trial: {
      daysLeft_one: '{count} day left in your trial',
      daysLeft_other: '{count} days left in your trial',
      body: 'You have everything unlocked. Choose a plan whenever you are ready.',
      cta: 'See plans',
    },
    notifications: {
      title: 'Notifications',
      label: 'Notifications',
      labelUnread_one: 'Notifications, {count} unread',
      labelUnread_other: 'Notifications, {count} unread',
      markAllRead: 'Mark all as read',
      unread: 'Unread',
      empty: 'Nothing needs you right now',
    },
  },

  locations: {
    title: 'Locations',
    subtitle: 'Your stores, their opening hours, and the geofence around each one.',
    empty: 'No locations yet',
    emptyBody: 'Add your first store so cards can surface when customers are nearby.',
    addLocation: 'Add a location',
    editLocation: 'Edit location',
    /**
     * Per-row results of a bulk location import.
     *
     * Written with the *business's* translator in `lib/wallet/locations.ts`
     * rather than the request's: the import runs server-side and the merchant
     * reads the failures row by row in the preview.
     */
    import: {
      nameRequired: 'Name is required',
      rowFailed: 'Could not import this row',
    },
    importLocations: 'Import from CSV',
    primary: 'Primary',
    makePrimary: 'Make primary',
    hidden: 'Hidden',
    visible: 'Visible',
    archived: 'Archived',
    archive: 'Archive location',
    archiveConfirm:
      'Archiving hides this store from cards and the join page. Its history is kept. Continue?',
    fields: {
      name: 'Store name',
      namePlaceholder: 'Gran Vía',
      description: 'Description',
      address: 'Street address',
      addressLine2: 'Apartment, suite, floor',
      city: 'City',
      region: 'Region',
      postalCode: 'Postal code',
      country: 'Country',
      phone: 'Phone',
      email: 'Email',
      coordinates: 'Coordinates',
      latitude: 'Latitude',
      longitude: 'Longitude',
      timezone: 'Time zone',
      visibility: 'Show on cards and the join page',
      sortOrder: 'Display order',
      externalRef: 'Your own reference',
    },
    geocode: {
      lookUp: 'Find coordinates',
      lookingUp: 'Looking up…',
      found: 'Found: {address}',
      notFound: 'We could not find that address. Enter the coordinates below.',
      notConfigured:
        'Automatic lookup is not configured on this deployment. Enter the coordinates below — everything works either way.',
      manualHint: 'Right-click a spot in Google Maps and copy the two numbers.',
    },
    hours: {
      title: 'Opening hours',
      subtitle:
        'Used to hold back "come in now" notifications when you are closed. Leave blank if you would rather we did not.',
      closed: 'Closed',
      open24: 'Open 24 hours',
      addRange: 'Add a second period',
      removeRange: 'Remove',
      from: 'From',
      to: 'To',
      copyToAll: 'Apply to every day',
      days: {
        mon: 'Monday',
        tue: 'Tuesday',
        wed: 'Wednesday',
        thu: 'Thursday',
        fri: 'Friday',
        sat: 'Saturday',
        sun: 'Sunday',
      },
      daysShort: {
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat',
        sun: 'Sun',
      },
    },
    geofence: {
      title: 'Geofence',
      subtitle: 'When and how far out this store reaches a customer’s phone.',
      enabled: 'Geofencing for this store',
      relevanceRadius: 'Card appears within',
      relevanceRadiusHelp:
        'How close a customer must be for the card to surface on their lock screen.',
      notificationRadius: 'Notify within',
      notificationRadiusHelp:
        'How close before a campaign notification can fire. Often wider than the card radius.',
      secondaryRadius: 'Outer ring',
      secondaryRadiusHelp: 'An optional wider ring for "getting close" messages.',
      triggers: 'Triggers',
      onEntry: 'When they arrive',
      onEntryHelp: 'Fires once when the customer crosses into the radius.',
      onExit: 'When they leave',
      onExitHelp: 'Useful for "thanks for visiting" and review requests.',
      onDwell: 'When they stay',
      onDwellHelp: 'Fires after they have been inside the radius for a while.',
      dwellMinutes: 'Stay for at least',
      relevantText: 'Lock screen message',
      relevantTextPlaceholder: 'Your free flat white is waiting on Gran Vía',
      relevantTextHelp:
        'What Apple Wallet shows on the lock screen for this store. Leave blank for a sensible default.',
      beacon: 'Beacon (optional)',
      beaconHelp: 'If you own iBeacon hardware, enter its identifiers.',
      beaconUuid: 'Proximity UUID',
      beaconMajor: 'Major',
      beaconMinor: 'Minor',
      noCoordinates: 'Add coordinates to switch geofencing on for this store.',
    },
  },

  wallet: {
    title: 'Wallet & proximity',
    subtitle:
      'How your card behaves in Apple Wallet and Google Wallet — and what happens when a customer walks past.',
    /**
     * The line a pass shows on a customer's lock screen when they are near a
     * shop, used when the merchant has not written their own.
     *
     * Resolved with the *business's* language, never the viewer's: nobody is
     * viewing anything when this fires. It is the highest-converting string in
     * the product and it used to be an English literal in `pass-content.ts`.
     */
    relevance: {
      rewardWaiting: '{reward} is waiting at {location}',
      yourReward: 'Your reward',
      nearby: 'You are near {location}',
    },
    /**
     * The card face — every label Apple Wallet and Google Wallet print on a
     * customer's phone.
     *
     * Resolved with the *business's* language, for the same reason `relevance`
     * is: a card is installed once and read for months, with no request in
     * sight. These were English literals in `apple-pass.ts` and
     * `google-loyalty-jwt.ts`, so a Spanish café's customers carried a card
     * labelled MEMBER / SINCE / TO GO with `en-GB` dates. It is the most
     * permanent surface the product has and the one surface a merchant cannot
     * correct from the dashboard.
     *
     * `%@` in `balanceChange` is Apple's own substitution token for the new
     * value — it is not one of ours and must survive translation.
     */
    pass: {
      tier: 'TIER',
      vip: 'VIP',
      balanceChange: 'You now have %@ {unit}',
      readyToClaim: 'READY TO CLAIM',
      nextReward: 'NEXT REWARD',
      rewardFallback: 'Reward',
      rewardReadyTitle: 'Reward ready',
      toGo: 'TO GO',
      member: 'MEMBER',
      since: 'SINCE',
      howItWorks: 'How it works',
      howItWorksGoal:
        'Collect {goal} {unit} and get {reward}. Show this card at the counter on every visit.',
      howItWorksOpen: 'Show this card at the counter to collect {unit} on every visit.',
      yourReward: 'your reward',
      offer: 'Offer',
      offerUntil: 'Offer — until {date}',
      where: 'Where to use it',
      referral: 'Invite a friend',
      referralBody: 'Share your code {code} — you both get rewarded when they join.',
      referralBodyShort: 'Share your code {code} — you both get rewarded.',
      pointsExpire: '{unit} expire',
      website: 'Website',
      contact: 'Contact',
      manageCard: 'Manage your card',
      viewCard: 'View your card',
      goal: 'Goal',
      memberFallback: 'Member',
      logoAlt: '{name} logo',
      programName: '{business} Rewards',
      description: '{business} loyalty card',
      unitFallback: 'points',
    },
    /**
     * Fallback copy for a proximity push, used when the merchant's rule does not
     * carry its own title or message.
     *
     * `{{points}}` is a *notification template* token expanded later by
     * `renderNotificationCopy` against the customer's facts — not one of our
     * `{name}` interpolations. It survives translation because the translator
     * only substitutes when values are passed, and `pushNearbyBody` is resolved
     * without any. Leave the double braces alone.
     */
    push: {
      nearbyTitle: 'You are near {location}',
      nearbyBody: 'Your card is ready — {{points}} points so far.',
      cardReady: 'Your loyalty card is ready.',
      rewardTitle: 'Your reward is ready',
      rewardBody: 'You have a reward waiting at {location}.',
    },
    tabs: {
      design: 'Card design',
      brand: 'Brand',
      behaviour: 'Notifications',
      settings: 'Settings',
      campaigns: 'Campaigns',
      rules: 'Automation rules',
      analytics: 'Analytics',
      templates: 'Templates',
    },
    providers: {
      title: 'Wallet providers',
      configured: 'Ready',
      notConfigured: 'Not configured',
      missing: 'Missing: {vars}',
      notConfiguredBody:
        'Cards cannot be issued until these credentials are set on the deployment. Everything else on this page can be configured now and will take effect the moment they are.',
      pushReady: 'Pass updates enabled',
      pushMissing: 'Pass updates unavailable',
      supports: 'Supports',
      supportsGeofence: 'Geofenced relevance',
      supportsLockScreen: 'Lock screen suggestions',
      supportsBeacons: 'Beacons',
      supportsPush: 'Live pass updates',
      supportsRich: 'Custom notification text',
    },
    masterSwitches: {
      title: 'Proximity',
      proximityEnabled: 'Location-aware cards',
      proximityEnabledHelp:
        'Master switch. Off means cards carry no locations and no proximity notification is ever sent.',
      geofencingEnabled: 'Geofencing',
      geofencingEnabledHelp: 'Evaluate entry, exit and dwell triggers for your stores.',
      beaconsEnabled: 'Beacons',
      beaconsEnabledHelp: 'Include iBeacon identifiers on passes, if you own the hardware.',
    },
    suggestions: {
      title: 'Wallet suggestions',
      subtitle: 'What the wallet app is allowed to do with your card on its own.',
      appleLockScreen: 'Apple Wallet lock screen suggestions',
      appleLockScreenHelp: 'iOS surfaces the card when the customer is near one of your stores.',
      googleSuggestions: 'Google Wallet suggestions',
      googleSuggestionsHelp: 'Google surfaces the card near your stores.',
      nearbyRecommendations: 'Nearby recommendations',
      nearbyRecommendationsHelp: 'Show nearby stores and current offers on the customer’s card page.',
      automaticUpdates: 'Automatic pass updates',
      automaticUpdatesHelp: 'Push the new balance to installed cards the moment it changes.',
      dynamicContent: 'Dynamic card content',
      dynamicContentHelp: 'Show live offers and rewards on the back of the card.',
      rewardNotifications: 'Reward notifications',
      rewardNotificationsHelp: 'Tell customers when a reward is ready to claim.',
      loyaltyReminders: 'Loyalty reminders',
      loyaltyRemindersHelp: 'Gentle nudges for customers who have not been in for a while.',
      maxRelevantLocations: 'Stores per card',
      maxRelevantLocationsHelp:
        'Both wallets accept at most ten. With more stores than this we embed the ones nearest the customer.',
    },
    frequency: {
      title: 'How often, and when',
      subtitle:
        'A wallet card is deleted the first time it feels like spam, and there is no way to ask again. These limits are deliberately conservative.',
      defaultRadius: 'Default radius',
      defaultRadiusHelp: 'Used by every store that does not set its own.',
      defaultDwell: 'Default dwell time',
      maxPerDay: 'Most notifications per customer per day',
      minHoursBetween: 'Minimum gap between notifications',
      respectQuietHours: 'Respect quiet hours',
      quietFrom: 'Quiet from',
      quietUntil: 'until',
      quietHoursHelp: 'No notification is sent during these hours, whatever a campaign says.',
    },
    branding: {
      title: 'Notification wording',
      subtitle: 'The default text for lock-screen alerts and new campaigns.',
      emoji: 'Default emoji',
      notificationTitle: 'Default notification title',
      notificationMessage: 'Default notification message',
      cta: 'Default button label',
      colorsMovedNote:
        'Card colours, logo and layout live under Card design, so there is one place to change how your card looks.',
      brandColor: 'Card background',
      brandTextColor: 'Card text',
      logoUrl: 'Logo URL',
      heroImageUrl: 'Banner image URL',
      passExpiration: 'Card expires after',
      passExpirationHelp: 'Leave blank for a card that never expires.',
      passExpirationDays: '{count} days',
    },
    preview: {
      title: 'Live preview',
      subtitle: 'Exactly what your customers will see.',
      apple: 'Apple Wallet',
      google: 'Google Wallet',
      lockScreen: 'Lock screen',
      notification: 'Notification',
      balance: 'Points',
      tier: 'Tier',
      reward: 'Next reward',
      member: 'Member',
      memberSince: 'Since',
      showQr: 'Show code',
      whereToUse: 'Where to use it',
    },
    campaigns: {
      title: 'Proximity campaigns',
      subtitle: 'What to say, to whom, where and when.',
      empty: 'No proximity campaigns yet',
      emptyBody:
        'Start from a template for your kind of business, or write one from scratch.',
      create: 'New campaign',
      edit: 'Edit campaign',
      duplicate: 'Duplicate',
      activate: 'Switch on',
      pause: 'Pause',
      archive: 'Archive',
      testIt: 'Would this send?',
      sectionBasics: 'The basics',
      sectionTrigger: 'When it fires',
      sectionSchedule: 'Schedule',
      sectionAudience: 'Who gets it',
      sectionMessage: 'What they see',
      sectionDelivery: 'Delivery limits',
      name: 'Campaign name',
      kind: 'Type',
      description: 'Internal note',
      trigger: 'Trigger',
      triggers: {
        entry: 'When they arrive',
        exit: 'When they leave',
        dwell: 'When they stay a while',
        nearby: 'Whenever they are nearby',
        manual: 'Only when I send it',
      },
      radius: 'Radius',
      radiusHelp: 'Leave blank to use each store’s own setting.',
      dwellMinutes: 'After staying for',
      startsOn: 'Starts',
      endsOn: 'Ends',
      weekdays: 'Days',
      startTime: 'From',
      endTime: 'Until',
      timeHelp: 'Local time at each store.',
      allLocations: 'Every location',
      pickLocations: 'Only these locations',
      segment: 'Customer segment',
      segmentAny: 'Anyone',
      minTier: 'Minimum tier',
      minPoints: 'Minimum points',
      minVisits: 'Minimum visits',
      minDaysSinceVisit: 'Has not visited for at least',
      maxDaysSinceVisit: 'Visited within the last',
      vipOnly: 'VIP customers only',
      birthdayOnly: 'Only on their birthday',
      requiresReward: 'Only if a reward is ready to claim',
      requiresPass: 'Only if the card is in their wallet',
      messageTitle: 'Title',
      messageBody: 'Message',
      emoji: 'Emoji',
      ctaLabel: 'Button label',
      ctaUrl: 'Button link',
      rewardDescription: 'Reward description',
      imageUrl: 'Image URL',
      expiresAt: 'Offer expires',
      priority: 'Priority',
      priorityHelp: 'When several campaigns qualify, the highest priority wins.',
      cooldownHours: 'Wait before repeating',
      maxSends: 'Most times per customer',
      tokens: 'You can use: {tokens}',
      stats: {
        sent: 'Sent',
        impressions: 'Seen',
        clicks: 'Tapped',
        visits: 'Visits',
        redemptions: 'Redeemed',
        revenue: 'Revenue',
        conversion: 'Conversion',
      },
      preflight: {
        wouldSend: 'This would send',
        wouldNotSend: 'This would not send right now',
        because: 'Because:',
        testedAgainst: 'Tested against {name}',
        noCustomer: 'Add a customer first so this can be tested against a real profile.',
      },
    },
    rules: {
      title: 'Automation rules',
      subtitle: 'If this happens, do that. No code.',
      empty: 'No rules yet',
      emptyBody: 'Add one of the presets below, or build your own.',
      create: 'New rule',
      edit: 'Edit rule',
      presets: 'Ready-made rules',
      addPreset: 'Add',
      added: 'Added',
      name: 'Rule name',
      description: 'What it is for',
      whenAll: 'When all of these are true',
      whenAny: 'When any of these are true',
      addCondition: 'Add a condition',
      addAction: 'Add an action',
      then: 'Then',
      matchAll: 'All',
      matchAny: 'Any',
      priority: 'Order',
      priorityHelp: 'Lower numbers run first.',
      stopOnMatch: 'Stop after this rule matches',
      stopOnMatchHelp: 'Prevents a second rule sending a second notification for one visit.',
      cooldownHours: 'Wait before repeating',
      summary: 'In plain words',
      matched_one: 'Matched {count} time',
      matched_other: 'Matched {count} times',
      neverMatched: 'Has not matched yet',
      lastMatched: 'Last matched {when}',
    },
    analytics: {
      title: 'Proximity performance',
      subtitle: 'Whether it brings people in, and what that is worth.',
      range30: 'Last 30 days',
      range7: 'Last 7 days',
      range90: 'Last 90 days',
      funnel: 'The funnel',
      suggestions: 'Card suggestions',
      notificationsSent: 'Notifications sent',
      impressions: 'Seen',
      clicks: 'Tapped',
      walletOpens: 'Card opened',
      storeVisits: 'Store visits',
      redemptions: 'Rewards redeemed',
      passesInstalled: 'Cards installed',
      passesRemoved: 'Cards removed',
      geofenceEntries: 'Geofence crossings',
      revenue: 'Attributed revenue',
      uniqueCustomers: 'Customers reached',
      clickThrough: 'Tap rate',
      conversion: 'Visit rate',
      redemptionRate: 'Redemption rate',
      revenuePerSend: 'Revenue per notification',
      avgVisitDelay: 'Average time to visit',
      avgVisitDelayHelp:
        'How long after a notification a customer walked in. Only visits we can attribute are counted.',
      byCampaign: 'By campaign',
      byLocation: 'By location',
      recentNotifications: 'Recent notifications',
      notSent: 'Not sent',
      skipReasons: {
        no_pass_installed: 'Card not in their wallet',
        wallet_not_configured: 'Wallet not configured',
        quiet_hours: 'Quiet hours',
        daily_cap: 'Daily limit reached',
        too_soon: 'Sent too recently',
      },
      empty: 'No proximity activity yet',
      emptyBody:
        'Once a campaign is live and a customer walks past one of your stores, this fills in.',
      noRevenue: 'Not measured',
    },
    templates: {
      title: 'Wallet strategies',
      subtitle:
        'A complete setup for your kind of business — radiuses, hours, campaigns and rules. Everything arrives paused so you can read it first.',
      apply: 'Use this strategy',
      applying: 'Setting it up…',
      applied: 'Applied',
      includes: 'Sets up',
      includesCampaigns_one: '{count} campaign',
      includesCampaigns_other: '{count} campaigns',
      includesRules_one: '{count} rule',
      includesRules_other: '{count} rules',
      appliedNote:
        'Created and switched off. Review the copy that will reach your customers, then turn on what you want.',
      currentTemplate: 'Currently using the {name} strategy',
    },
  },

  join: {
    title: 'Join {business}',
    subtitle: 'Collect {goal} {unit} and get {reward}. No app needed.',
    rewardFallback: 'a reward',
    unitFallback: 'stamps',
    cardRewardFallback: 'A reward on us',
    email: 'Email',
    emailPlaceholder: 'you@email.com',
    firstName: 'First name (optional)',
    birthday: 'Birthday (optional)',
    birthdayHint: 'Tell us your birthday and we’ll send you a gift.',
    consentTerms: 'I agree to join this loyalty program and to {business} storing my details to run it.',
    consentMarketing: 'Send me offers and rewards. You can unsubscribe at any time.',
    submit: 'Get my card',
    submitting: 'Getting your card…',
    needsTerms: 'Please accept the terms to join.',
    failed: 'We could not sign you up. Please try again.',
    notFound: 'This loyalty program does not exist.',
    loadFailed: 'We could not load this page. Please try again.',
    done: 'You’re in!',
    doneBody: 'Add your card to your phone so you never lose it.',
    openInBrowser: 'Or open your card in the browser',
    inviteTitle: 'Invite a friend',
    inviteBody: 'Share your code and you both get rewarded when they join and visit.',
    share: 'Share',
    emailedTo: 'We also emailed your card to {email}.',
  },

  /**
   * The public gift card shop.
   *
   * A stranger's first and possibly only screen, and the only page in the
   * product where money changes hands with someone who has no account. It was
   * missed by the previous localisation pass because it owned no keys at all —
   * the exact blind spot the screen-coverage test in `tests/unit/i18n.test.ts`
   * exists to close, which is why `giftShop` is now on that list.
   *
   * Amounts are formatted from the merchant's own currency rather than a
   * hardcoded `€`, which is what the page used to print regardless of what the
   * business actually charges in.
   */
  giftShop: {
    header: 'Gift card',
    headerCity: 'Gift card · {city}',
    notOnSale: 'Gift cards are not on sale here',
    notOnSaleBody: '{business} is not selling gift cards online at the moment.',
    thankYou: 'Thank you',
    thankYouBody:
      'Your gift card for {business} is confirmed. We have emailed the recipient, and sent you a copy of the code in case you would rather hand it over yourself.',
    howMuch: 'How much?',
    orAnyAmount: 'Or any amount between {min} and {max}',
    whoFor: 'Who is it for?',
    theirName: 'Their name',
    theirNamePlaceholder: 'María',
    theirEmail: 'Their email',
    theirEmailPlaceholder: 'maria@example.com',
    messageOptional: 'A message (optional)',
    messagePlaceholder: 'Happy birthday! Coffee is on me.',
    sendOn: 'Send it on (optional)',
    sendOnHint: 'Leave empty to send it right away. Otherwise it arrives that morning.',
    whoFrom: 'And who is it from?',
    yourName: 'Your name',
    yourEmail: 'Your email',
    receiptNote: 'For your receipt. Nothing else.',
    design: 'Design',
    designs: {
      classic: 'Classic',
      birthday: 'Birthday',
      thankYou: 'Thank you',
      celebration: 'Celebration',
      festive: 'Festive',
    },
    pay: 'Pay {amount}',
    stripeNote: 'Payment handled by Stripe. We never see your card details.',
    paymentFailed: 'Could not start the payment. Please try again.',
    failed: 'Something went wrong',
  },

  /**
   * The card designer.
   *
   * Merchant-facing and deliberately free of jargon: "card style" rather than
   * "pass surface treatment", "what to show" rather than "field visibility". The
   * person reading these owns a bakery.
   */
  cardDesign: {
    title: 'Card design',
    subtitle: 'How your loyalty card looks in your customers’ wallets.',
    tabDesign: 'Design',
    tabBehaviour: 'Behaviour',
    designHint: 'Colours, logo and layout. Changes appear in the preview instantly.',
    behaviourHint: 'When the card notifies your customers, and how often.',

    templates: {
      title: 'Start from a template',
      subtitle: 'Pick one, then change anything you like.',
      applied: 'Template applied',
      basedOn: 'Based on {name}',
      minimal: { name: 'Minimal', description: 'Clean and quiet. Lets your logo do the talking.' },
      premium: { name: 'Premium', description: 'Warm gradient and serif type for a considered feel.' },
      modern: { name: 'Modern', description: 'Bold two-tone with rounded type.' },
      coffee: { name: 'Coffee shop', description: 'Stamps front and centre, espresso browns.' },
      restaurant: { name: 'Restaurant', description: 'Points and tiers for guests who spend.' },
      bakery: { name: 'Bakery', description: 'Soft, floury tones with a stamp card.' },
      barber: { name: 'Barber', description: 'Sharp and blue, counting visits.' },
      beauty: { name: 'Beauty salon', description: 'Points and tiers in a soft rose palette.' },
      gym: { name: 'Gym', description: 'Membership tiers with a high-contrast finish.' },
      retail: { name: 'Retail', description: 'Points-based, built for repeat baskets.' },
      luxury: { name: 'Luxury', description: 'Tier only. No progress bars, no discount cues.' },
    },

    style: {
      title: 'Card style',
      solid: 'Solid',
      gradient: 'Gradient',
      duotone: 'Two-tone',
      frosted: 'Frosted',
    },

    progress: {
      title: 'Show progress as',
      auto: 'Automatic',
      autoHint: 'Stamps for stamp cards, a bar for points.',
      bar: 'Progress bar',
      stamps: 'Stamps',
      points: 'Just the number',
      none: 'Don’t show progress',
      tooManyStamps:
        'A goal of {count} is too many to draw as stamps, so a bar is used instead.',
    },

    typography: {
      title: 'Typeface',
      system: 'Standard',
      rounded: 'Rounded',
      serif: 'Serif',
      mono: 'Mono',
    },

    colors: {
      title: 'Colours',
      background: 'Card background',
      foreground: 'Text',
      accent: 'Accent',
      inherit: 'Using your brand colours',
      reset: 'Reset to brand',
      autoText: 'Chosen automatically for legibility',
      contrastWarning:
        'This text colour is hard to read on that background, so a legible one is used instead.',
    },

    show: {
      title: 'What to show on the card',
      memberName: 'Customer name',
      memberSince: 'Member since',
      tier: 'Tier',
      location: 'Store',
      reward: 'Next reward',
      progress: 'Progress',
    },

    copy: {
      title: 'Your words',
      headline: 'Card title',
      headlinePlaceholder: 'Defaults to your business name',
      customMessage: 'Message on the back',
      customMessagePlaceholder: 'Thanks for being a regular.',
      terms: 'Small print',
      termsPlaceholder: 'One reward per visit. Not exchangeable for cash.',
    },

    back: {
      title: 'Back of the card',
      empty: 'Add a message or small print and it will appear here.',
      show: 'Show the back',
      showFront: 'Show the front',
    },

    logo: {
      title: 'Your logo',
      sharedHint:
        'This is your brand logo. Changing it here updates it everywhere — your card, your join page and your emails.',
    },

    preview: {
      title: 'Preview',
      disclaimer:
        'A preview of your design. The real pass is generated by Apple and Google once credentials are configured.',
      notConfigured: 'Wallet passes are not active on this deployment yet.',
      notConfiguredBody:
        'Your design is saved and will be used the moment credentials are added for {providers}. Until then customers get the browser card, which uses the same design.',
      sampleCustomer: 'Sample customer',
      /* Stand-ins for a business that has not named its program yet. Shown in
         the preview only, never written to a real card. */
      defaultProgram: 'Loyalty card',
      defaultUnitSingular: 'point',
      defaultUnitPlural: 'points',
    },

    save: 'Save design',
    saved: 'Design saved',
    saveFailed: 'We could not save your design. Please try again.',
    unsaved: 'Unsaved changes',
  },

  /**
   * The brand kit — one identity, reused everywhere the business is shown.
   */
  brandKit: {
    title: 'Brand',
    subtitle: 'Your logo, colours and details. Used on cards, pages and emails.',
    identity: 'Identity',
    name: 'Business name',
    description: 'Short description',
    descriptionPlaceholder: 'Speciality coffee and pastries, since 2019.',
    logo: 'Logo',
    logoHint: 'A square PNG, JPG or WebP. Shown on your loyalty card.',
    logoUpload: 'Upload a logo',
    logoReplace: 'Replace logo',
    logoUploading: 'Uploading…',
    logoUrlFallback: 'Paste a link to your logo. File uploads are off on this deployment.',
    logoErrors: {
      empty: 'That file is empty.',
      tooLarge: 'That file is too large. The limit is {max} MB.',
      unsupportedFormat: 'Use a PNG, JPG or WebP image.',
      uploadFailed: 'We could not upload that logo. Please try again.',
    },
    icon: 'Icon',
    cover: 'Cover image',
    colors: 'Colours',
    colorsHint: 'Your card, your join page and your emails all use these.',
    primary: 'Primary',
    secondary: 'Secondary',
    secondaryOptional: 'Optional',
    accent: 'Accent',
    textColor: 'Text',
    useLegibleText: 'Use a legible colour',
    font: 'Typeface',
    contact: 'Contact',
    contactHint: 'Shown on the back of your card and on your join page.',
    email: 'Email',
    phone: 'Phone',
    website: 'Website',
    address: 'Address',
    city: 'City',
    postalCode: 'Postcode',
    social: 'Social',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    handlePlaceholder: 'yourbusiness',
    handleHint: 'Just the username — we build the link.',
    usedIn: 'Used on your loyalty card, join page, emails and campaigns.',
    saved: 'Brand saved',
    saveFailed: 'We could not save your brand. Please try again.',
  },

  card: {
    title: 'Your card',
    balance: 'Your balance',
    addToApple: 'Add to Apple Wallet',
    addToGoogle: 'Save to Google Wallet',
    walletUnavailable: 'Wallet cards are not available on this deployment yet.',
    showAtCounter: 'Show this at the counter',
    progress: 'Progress',
    toGo_one: '{count} to go',
    toGo_other: '{count} to go',
    rewardReady: 'Your reward is ready',
    rewardReadyBody: 'Show this card at the counter to claim it.',
    nearby: 'Where to use it',
    nearbyOpen: 'Open now',
    nearbyClosed: 'Closed',
    nearbyDistance: '{distance} away',
    offers: 'Offers for you',
    waitingForYou: 'Waiting for you',
    showCodeAtCounter: 'Show this code at the counter',
    validUntil: 'Valid until {date}',
    giftCardBalance: 'Gift card balance',
    earnMultiplier: 'You earn {multiplier}× on everything',
    renews: 'Renews {date}',
    rewardsYouCanEarn: 'Rewards you can earn',
    ready: 'Ready',
    keepItOnYourPhone: 'Keep it on your phone',
    inviteAFriend: 'Invite a friend',
    inviteBody: 'You both get rewarded when they join and visit.',
    shareInvite: 'Share my invite',
    linkCopied: 'Link copied',
    memberSinceDate: 'Member since {date}',
    linkExpired: 'This link has expired. Ask the shop to send you a new one.',
    couldNotLoad: 'We could not load your card.',
    moreToReach: '{count} more to reach {tier}',
    enableLocation: 'Show me the nearest store',
    enableLocationBody:
      'We use your location once, in your browser, to sort the list. Nothing is stored beyond a rough position.',
    locationDenied: 'No problem — here are all your locations.',
  },

  /**
   * Industry wallet strategies — the gallery, and the copy a template seeds.
   *
   * Two audiences share this namespace, and the distinction matters more than it
   * looks. `name`, `summary` and every `description` are read by a *merchant*
   * choosing a strategy. Every `title`, `message` and `cta` is written into a
   * campaign row and ends up on a *customer's lock screen* — which is why these
   * are resolved with the business's locale at the moment a template is applied,
   * not with the locale of whoever happened to click.
   */
  walletTemplates: {
    rules: {
      rewardReady: {
        name: 'Reward waiting nearby',
        description: 'When a customer with a claimable reward comes close, remind them.',
      },
      birthday: {
        name: 'Birthday reward',
        description: 'On a customer’s birthday, activate their birthday treat.',
        title: 'Happy birthday!',
        message: 'Your birthday treat is waiting for you today.',
        cta: 'See your reward',
      },
      winBack: {
        name: 'Welcome back',
        description: 'When someone who has not visited in a while passes by, invite them in.',
        title: 'We have missed you',
        message: 'It has been a while. Come in and pick up where you left off.',
        cta: 'Open my card',
      },
      vip: {
        name: 'VIP arrival',
        description: 'Alert the team when a VIP walks in, so they get looked after.',
        title: 'A VIP customer just arrived',
      },
    },

    coffee_shop: {
      name: 'Coffee shop',
      summary: 'Morning regulars, small radius, one nudge a day at most.',
      campaigns: {
        coffee_morning: {
          name: 'Morning coffee',
          description: 'Catch the commute between 07:00 and 10:30 on weekdays.',
          title: 'Your morning coffee is ready',
          message: 'You are around the corner. Your usual, and a stamp on the card.',
          cta: 'Open my card',
        },
        reward_ready: {
          name: 'Free coffee waiting',
          description: 'Only for customers who have already earned their free cup.',
          title: 'Your free coffee is waiting',
          message: 'You have earned it. Show your card at the counter.',
          cta: 'Claim now',
          reward: 'One free coffee of your choice',
        },
        win_back: {
          name: 'Haven’t seen you in a while',
          description: 'Reaches lapsed regulars when they happen to be nearby.',
          title: 'Your table is still here',
          message: 'It has been a couple of weeks. Come and have one on us.',
          cta: 'See my card',
        },
      },
    },

    bakery: {
      name: 'Bakery',
      summary: 'Fresh-batch timing, weekend mornings, short radius.',
      campaigns: {
        coffee_morning: {
          name: 'Out of the oven',
          description: 'The morning batch, every day until it sells out.',
          title: 'Fresh out of the oven',
          message: 'Still warm. You are two minutes away.',
          cta: 'Open my card',
        },
        weekend: {
          name: 'Weekend treat',
          description: 'Saturday and Sunday, when families buy for the table.',
          title: 'Weekend baking is in',
          message: 'Something for the table? Double stamps all weekend.',
          cta: 'See the card',
        },
      },
    },

    restaurant: {
      name: 'Restaurant',
      summary: 'Lunch and dinner windows, wider radius, table-booking CTA.',
      campaigns: {
        lunch: {
          name: 'Lunch menu',
          description: 'Weekday lunch, aimed at people already in the area.',
          title: 'Today’s lunch menu',
          message: 'Two courses and a coffee. A table is free right now.',
          cta: 'See the menu',
        },
        weekend: {
          name: 'Weekend dinner',
          description: 'Friday and Saturday evenings.',
          title: 'Dinner tonight?',
          message: 'We have a table at 20:30. Your points come with it.',
          cta: 'Book a table',
        },
        vip_event: {
          name: 'VIP tasting',
          description: 'Regulars only — your most valuable customers.',
          title: 'An invitation, just for you',
          message: 'A tasting evening for our regulars. Twelve seats.',
          cta: 'Reserve a seat',
        },
      },
    },

    barber_shop: {
      name: 'Barber shop',
      summary: 'Appointment cadence: nudge at four weeks, not at the door.',
      campaigns: {
        custom: {
          name: 'Time for a trim',
          description: 'Fires once someone is four weeks past their last cut.',
          title: 'Due for a trim?',
          message: 'It has been about four weeks. We have a chair free today.',
          cta: 'Book now',
        },
        reward_ready: {
          name: 'Free cut earned',
          description: 'Every tenth cut, when they are nearby.',
          title: 'Your free cut is waiting',
          message: 'Ten visits, one on us. Come in whenever suits.',
          cta: 'Claim it',
        },
      },
    },

    beauty_salon: {
      name: 'Beauty salon',
      summary: 'Booking-led, quiet frequency, VIP treatment for regulars.',
      campaigns: {
        custom: {
          name: 'Rebooking reminder',
          description: 'Six weeks after the last appointment.',
          title: 'Ready for your next appointment?',
          message: 'We have space this week, and your points are waiting.',
          cta: 'Book now',
        },
        vip_event: {
          name: 'VIP evening',
          description: 'A private evening for your best clients.',
          title: 'You are invited',
          message: 'A VIP evening with treatments and a glass of something.',
          cta: 'Save my place',
        },
      },
    },

    gym: {
      name: 'Gym & fitness',
      summary: 'Absence is the problem, not proximity. Large radius, streak nudges.',
      campaigns: {
        custom: {
          name: 'You are close — train today',
          description: 'Nudges members who are nearby but have skipped a week.',
          title: 'You are two minutes away',
          message: 'A short session still counts. Keep the streak alive.',
          cta: 'Check in',
        },
        double_points: {
          name: 'Off-peak double points',
          description: 'Fills the quiet mid-afternoon hours.',
          title: 'Double points this afternoon',
          message: 'Quiet floor, twice the points. Until 16:00.',
          cta: 'See my card',
        },
        win_back: {
          name: 'Come back stronger',
          description: 'Members who have not trained in a month.',
          title: 'Your membership is waiting',
          message: 'One session is all it takes to start again. We will help.',
          cta: 'Book an induction',
        },
      },
    },

    retail_store: {
      name: 'Retail store',
      summary: 'Footfall-driven: catch people already on the street.',
      campaigns: {
        welcome: {
          name: 'You are nearby',
          description: 'A light nudge for members walking past.',
          title: 'You are right outside',
          message: 'Your points are ready to spend. New arrivals in store.',
          cta: 'Open my card',
        },
        weekend: {
          name: 'Weekend promotion',
          description: 'Friday to Sunday, when retail footfall peaks.',
          title: 'Weekend offer for members',
          message: 'Members save this weekend. Show your card at the till.',
          cta: 'See the offer',
        },
        seasonal: {
          name: 'Seasonal sale',
          description: 'A dated campaign you switch on for a sale period.',
          title: 'The sale starts today',
          message: 'Members get first pick. Your points still apply.',
          cta: 'Shop the sale',
        },
      },
    },

    pet_shop: {
      name: 'Pet shop',
      summary: 'Predictable repeat cycles: food runs out on a schedule.',
      campaigns: {
        custom: {
          name: 'Time to restock',
          description: 'Four weeks after the last visit — about one bag of food.',
          title: 'Running low?',
          message: 'You are nearby, and it has been about a month. We have your usual.',
          cta: 'Open my card',
        },
        reward_ready: {
          name: 'Reward ready',
          description: 'Loyalty reward for repeat customers.',
          title: 'A treat on us',
          message: 'Your loyalty reward is ready to collect.',
          cta: 'Claim it',
        },
      },
    },

    pharmacy: {
      name: 'Pharmacy',
      summary: 'Deliberately quiet. Trust matters more than frequency.',
      campaigns: {
        reward_ready: {
          name: 'Reward available',
          description: 'The only proximity message a pharmacy should send.',
          title: 'Your reward is available',
          message: 'You have a reward to collect on your next visit.',
          cta: 'View my card',
        },
      },
    },

    supermarket: {
      name: 'Supermarket',
      summary: 'Weekly shop rhythm, wide radius, offers over reminders.',
      campaigns: {
        welcome: {
          name: 'Members’ prices today',
          description: 'Catches the weekly shop as customers arrive.',
          title: 'Members’ prices today',
          message: 'Scan your card at the till and today’s member prices apply.',
          cta: 'Open my card',
        },
        double_points: {
          name: 'Double points midweek',
          description: 'Moves demand out of the Saturday peak.',
          title: 'Double points today',
          message: 'Midweek shop, twice the points. Until closing.',
          cta: 'See my card',
        },
      },
    },
  },

  admin: {
    title: 'Platform admin',
    subtitle: 'Every business on this deployment.',
    tabs: {
      overview: 'Overview',
      businesses: 'Businesses',
      plans: 'Plans',
      wallet: 'Wallet',
      audit: 'Impersonation log',
    },
    metrics: {
      businesses: 'Businesses',
      active: 'Paying',
      trialing: 'On trial',
      lapsed: 'Inactive',
      customers: 'Customers',
      scans: 'Scans (30 days)',
      passes: 'Wallet cards',
      mrr: 'MRR',
    },
    businesses: {
      search: 'Search businesses',
      plan: 'Plan',
      status: 'Status',
      customers: 'Customers',
      locations: 'Locations',
      created: 'Joined',
      owner: 'Owner',
      actions: 'Actions',
      view: 'View',
      impersonate: 'View as merchant',
      changePlan: 'Change plan',
      empty: 'No businesses match that.',
    },
    planChange: {
      title: 'Change plan',
      body: 'This writes to the merchant’s own audit log. They will see that support changed their plan, and why.',
      plan: 'New plan',
      trialEndsAt: 'Trial ends',
      reason: 'Reason',
      reasonPlaceholder: 'Failed Stripe webhook — customer paid for Pro on 12 June',
      submit: 'Apply the change',
    },
    impersonate: {
      title: 'View as merchant',
      body: 'This is recorded, visible to the merchant, and expires in an hour. It is read-only: you can see what they see, not act as them.',
      reason: 'Why do you need this?',
      reasonPlaceholder: 'Support ticket #482 — customer cannot see their campaigns',
      start: 'Start session',
      stop: 'End session',
      active: 'Viewing {name} as support · ends {when}',
    },
    capabilities: {
      title: 'Deployment capabilities',
      subtitle: 'Which integrations have credentials on this deployment.',
      configured: 'Configured',
      missing: 'Not configured',
    },
  },

  /**
   * The shared loading / empty / error states.
   *
   * Every list in the dashboard renders these, so translating them once is what
   * stops a Spanish screen flashing "Loading…" before its Spanish content
   * arrives — the mixed-language failure that is hardest to see in review,
   * because it only exists for the duration of a fetch.
   */
  states: {
    loading: 'Loading',
    tooManyRequests: 'Too many requests',
    unexpected: 'An unexpected error occurred.',
  },

  metrics: {
    newThisPeriod: 'New this period',
    vsPreviousPeriod: 'vs previous period',
    progress: 'Progress',
  },

  overview: {
    members: 'Members',
    membersHint:
      'Everyone enrolled in your loyalty program. The trend compares new signups in this period against the previous one.',
    repeatRate: 'Repeat rate',
    repeatRateHint:
      'Share of members who have visited more than once. This is the number a loyalty program exists to move.',
    revenue30: 'Revenue (30 days)',
    revenue30Hint:
      'Recorded spend from identified members. Connect your point of sale to capture every transaction automatically.',
    atRisk: 'At risk',
    atRiskHint:
      'Members with no visit in 60+ days. Each one is a customer you already paid to acquire.',
    activity: 'Activity',
    last30Days: 'Last 30 days',
    tabVisits: 'Visits',
    tabRevenue: 'Revenue',
    noActivity: 'No activity yet',
    noActivityBody: 'Record your first visit at the counter and this chart comes to life.',
    openPos: 'Open the point of sale',
    doThisNext: 'Do this next',
    aiSpotted: 'AI spotted',
    seeAllInsights: 'See all insights',
    bestCustomers: 'Your best customers',
    noMembers: 'No members yet',
    noMembersBody: 'Once people join, your highest-value regulars appear here.',
    visitsCount_one: '{count} visit',
    visitsCount_other: '{count} visits',
    programHealth: 'Program health',
    health: {
      retention: 'Retention',
      retentionHint: 'Members active in the last 30 days',
      churn: 'Churn',
      churnHint: 'Members with no visit in 60+ days',
      averageTicket: 'Average ticket',
      averageTicketHint: 'Average spend per recorded purchase',
      customerValue: 'Customer value',
      customerValueHint: 'Average lifetime spend per member',
      rewardsClaimed: 'Rewards claimed',
      rewardsClaimedHint: 'In the last 30 days',
      outstanding: 'Outstanding balance',
      outstandingHint: 'Unredeemed points and stamps — a liability on your books',
      nps: 'NPS',
      npsResponses_one: '{count} response in the last 30 days',
      npsResponses_other: '{count} responses in the last 30 days',
      npsNone: 'No survey responses yet',
    },
    actions: {
      lapsedTitle_one: '{count} member has gone quiet',
      lapsedTitle_other: '{count} members have gone quiet',
      lapsedBody: 'Send them a reason to come back before they forget you exist.',
      lapsedCta: 'Win them back',
      firstMemberTitle: 'Add your first member',
      firstMemberBody: 'Print your QR code or enrol someone at the counter to get started.',
      firstMemberCta: 'Get my QR code',
      repeatTitle: 'Only {rate} come back',
      repeatBody: 'Your reward may be too far away. Review the goal on your program.',
      repeatCta: 'Review rewards',
      feedbackTitle: 'You have no feedback yet',
      feedbackBody: 'Ask members how their last visit went — it takes them one tap.',
      feedbackCta: 'Turn on surveys',
      healthyTitle: 'Everything looks healthy',
      healthyBody: 'Good moment to try a campaign and push repeat visits higher.',
      healthyCta: 'Create a campaign',
    },
  },

  customers: {
    title: 'Customers',
    subtitleDefault: 'Your loyalty program members',
    subtitleCount_one: '{count} member',
    subtitleCount_other: '{count} members',
    export: 'Export',
    import: 'Import',
    addCustomer: 'Add a customer',
    searchPlaceholder: 'Search by name, email or phone',
    searchLabel: 'Search customers',
    allCustomers: 'All customers',
    filterLabel: 'Segment',
    sort: {
      recent: 'Recently joined',
      spend: 'Highest spend',
      visits: 'Most visits',
      churn: 'Highest churn risk',
      name: 'Name A–Z',
    },
    noMatches: 'No matches',
    noMatchesBody: 'Try a different search term, or clear the segment filter.',
    clearFilters: 'Clear filters',
    empty: 'No members yet',
    emptyBody: 'Put your QR code on the counter, or add someone at the point of sale.',
    emptyCta: 'Add your first customer',
    columns: {
      customer: 'Customer',
      balance: 'Balance',
      visits: 'Visits',
      spend: 'Spend',
      lastVisit: 'Last visit',
      status: 'Status',
    },
    rewardReady: 'Ready',
    statusNeverVisited: 'Never visited',
    statusActive: 'Active',
    statusAtRisk: 'At risk',
    statusLost: 'Lost',
    pagination: '{from}–{to} of {total}',
    paginationLabel: 'Pagination',
    mobileSummary: '{visits} · {spend} · {when}',
    profile: {
      back: 'All customers',
      memberSince: 'Member since {date}',
      markVip: 'Mark as VIP',
      removeVip: 'Remove VIP',
      visits: 'Visits',
      totalSpend: 'Total spend',
      averageTicket: 'Average ticket',
      churnRisk: 'Churn risk',
      summarise: 'Summarise this customer',
      summaryEmpty: 'Not enough history yet.',
      summaryFailed: 'We could not generate a summary right now.',
      loyalty: 'Loyalty',
      rewards: 'Rewards',
      rewardFallback: 'Reward',
      membership: 'Membership',
      membershipFallback: 'Membership',
      signUp: 'Sign up',
      notAMember: 'Not a member. Regulars on a monthly plan visit more and spend more.',
      periodsPaid_one: '{count} period · paid {amount}',
      periodsPaid_other: '{count} periods · paid {amount}',
      ending: 'Ending',
      active: 'Active',
      renewsOn: 'Renews {date}',
      endsOn: 'Ends {date}',
      cancelAtPeriodEnd: 'Cancel at period end',
      loadingPlans: 'Loading plans…',
      noPlans: 'No membership plans yet.',
      createOne: 'Create one',
      couldNotEnrol: 'We could not sign them up',
      couldNotCancel: 'We could not cancel that',
      consent: 'Consent',
      consentEmail: 'Email',
      consentSms: 'SMS',
      consentWhatsapp: 'WhatsApp',
      consentMarketing: 'Marketing offers',
      consentLabel: '{channel} consent',
      consentUpdated: 'Last updated {date}',
      consentUpdatedVia: 'Last updated {date} via {source}',
      notes: 'Notes',
      notesEmpty: 'No notes yet.',
      notePlaceholder: 'Allergic to nuts. Always orders the flat white.',
      noteLabel: 'New note',
      addNote: 'Add note',
      noteFailed: 'We could not save the note',
      staff: 'Staff',
      history: 'History',
      historyEmpty: 'Nothing recorded yet.',
      via: 'via {source}',
      messageFallback: 'Message',
      skipped: 'skipped ({reason})',
      activity: {
        signup: 'Joined the program',
        visit: 'Visit recorded',
        purchase: 'Purchase',
        redeem: 'Reward claimed',
        referral: 'Referred a friend',
        survey: 'Left feedback',
        tier_change: 'Tier changed',
        gift_card: 'Gift card used',
        wallet_add: 'Added card to wallet',
      },
    },
    importer: {
      back: 'Customers',
      title: 'Import customers',
      subtitle:
        'Bring your existing list across. Balances come with them, so nobody loses progress.',
      chooseFile: 'Choose a CSV file',
      reading: 'Reading your file…',
      accepts: 'Exports from Square, Toast, Mailchimp and plain spreadsheets all work',
      readFailed: 'We could not read that file',
      startFailed: 'We could not start the import',
      checkColumns: 'Check the columns',
      matched: 'We matched {matched} of {total} columns automatically. Adjust anything that looks wrong.',
      skipColumn: 'Skip this column',
      needsIdentifier:
        'Map at least an email or a phone column — we need one of them to identify each customer.',
      preview: 'Preview',
      rowsTotal: '{count} rows in total. Existing customers are updated, not duplicated.',
      chooseAnother: 'Choose a different file',
      importCta_one: 'Import {count} customer',
      importCta_other: 'Import {count} customers',
      started: 'Import started',
      startedBody:
        '{count} rows are being processed in the background. You can keep working — your customer list will fill in over the next few minutes.',
      backToCustomers: 'Back to customers',
      fields: {
        email: 'Email',
        phone: 'Phone',
        name: 'Name',
        first_name: 'First name',
        last_name: 'Last name',
        birthday: 'Birthday',
        balance: 'Balance',
        visits: 'Visits',
        spend: 'Spend',
        tags: 'Tags',
        notes: 'Notes',
        created_at: 'Joined on',
        external_id: 'Your own reference',
      },
    },
  },

  rewards: {
    title: 'Rewards',
    subtitle: 'What customers earn, and how hard they have to work for it',
    newReward: 'New reward',
    editReward: 'Edit reward',
    goalLine: '{goal} {unit} for a reward',
    openEnded: 'Open-ended {unit} program',
    optimise: 'Is my program set up right?',
    aiAssessment: 'AI assessment',
    verdict: {
      too_easy: 'Too easy',
      well_balanced: 'Well balanced',
      too_hard: 'Too hard',
    },
    members: 'Members',
    outstanding: 'Outstanding balance',
    activeRewards: 'Active rewards',
    empty: 'No rewards yet',
    emptyBody:
      'Add the thing customers are working towards — a free coffee, 10% off, a free haircut.',
    emptyCta: 'Create your first reward',
    editLabel: 'Edit {name}',
    auto: 'Automatic: {trigger}',
    costLabel: '{cost} {unit}',
    stockLeft_one: '{count} left',
    stockLeft_other: '{count} left',
    claimed_one: 'Claimed {count} time',
    claimed_other: 'Claimed {count} times',
    neverClaimed: 'Never claimed yet',
    nobodyClaimed: 'Nobody has claimed this. It may cost too much, or simply not appeal.',
    formSubtitle: 'Keep it to something a regular can reach in a few visits.',
    name: 'Reward',
    namePlaceholder: 'Free coffee',
    description: 'Description',
    descriptionPlaceholder: 'Any drink up to a large latte',
    cost: 'Cost in {unit}',
    costHint:
      'At {cost} {unit}, a customer who visits weekly reaches this in about {weeks} weeks. Under six weeks keeps people engaged.',
    availableLabel: 'Available to customers',
    availableHint: 'Paused rewards stay in your history',
    createCta: 'Create reward',
    defaultUnit: 'points',
  },

  giftCards: {
    title: 'Gift cards',
    subtitle: 'Money in the till today for something you serve later',
    why: 'Why merchants switch this on',
    whyCashTitle: 'Cash upfront',
    whyCashBody: 'You are paid today and serve the coffee whenever they come in.',
    whyNewTitle: 'New customers',
    whyNewBody:
      'A gift card is bought by one person and redeemed by another — usually someone who has never been in.',
    whyBreakageTitle: 'Unspent balance',
    whyBreakageBody: 'Most cards are never fully redeemed. That remainder is margin.',
    shopWouldLiveAt: 'Your shop would live at {path}',
    upsellTitle: 'Start selling gift cards',
    upsellBody: 'One link, shareable anywhere. You are paid the moment someone buys.',
    copyShopLink: 'Copy the shop link',
    issueCard: 'Issue a card',
    sold30: 'Sold in the last 30 days',
    sold30Hint: 'Cash collected in the last 30 days from gift card sales.',
    outstanding: 'Outstanding balance',
    outstandingHint:
      'What your customers can still spend. This is a liability, not revenue — you owe these goods.',
    redeemed: 'Redeemed',
    redeemedHint: 'Value already spent in store. This is the part that has turned into footfall.',
    activeCards: 'Active cards',
    activeCardsHint: 'Cards with a balance left on them.',
    onlineShop: 'Your online gift card shop',
    searchPlaceholder: 'Search by code, name or email',
    searchLabel: 'Search gift cards',
    filter: {
      all: 'All cards',
      active: 'Active',
      depleted: 'Used up',
      expired: 'Expired',
      void: 'Cancelled',
    },
    scheduled: 'Scheduled',
    noMatches: 'No cards match that',
    noMatchesBody: 'Try a different code, name or email.',
    empty: 'No gift cards yet',
    emptyBody:
      'Share your shop link, or issue one at the counter for a customer paying cash.',
    emptyCta: 'Issue your first card',
    tableCaption: 'Gift cards',
    columns: {
      code: 'Code',
      recipient: 'Recipient',
      balance: 'Balance',
      issued: 'Issued',
      status: 'Status',
    },
    ofTotal: 'of {amount}',
    cancelCard: 'Cancel card {code}',
    cancelCardTitle: 'Cancel this card',
    issued: 'Card issued',
    issuedOnItsWay: 'On its way to {email}.',
    issuedWriteCode: 'Write this code on the card you hand over.',
    issueTitle: 'Issue a gift card',
    issueSubtitle: 'For a customer paying at the counter, or as a goodwill gesture.',
    amount: 'Amount',
    amountLabel: 'Gift card amount',
    recipientName: 'Who is it for?',
    recipientNamePlaceholder: 'María',
    emailIt: 'Email it to them',
    emailItHint: 'Turn this off if you are handing over a printed card',
    recipientEmail: 'Their email',
    message: 'A short message',
    messagePlaceholder: 'Happy birthday! Enjoy a coffee on us.',
    issueAmountCta: 'Issue a {amount} card',
    issueFailed: 'We could not issue the card',
  },

  memberships: {
    title: 'Memberships',
    subtitle: 'Revenue that arrives whether or not it rains',
    whatItDoes: 'What a membership actually does',
    whatItDoesBody:
      'A stamp card rewards someone for coming back. A membership gets them to decide once, in advance, and then keeps charging. A café selling “€19 a month, a coffee a day” to sixty regulars has €1,140 in the bank on the first of every month — and those sixty people now walk past your competitor to get the coffee they have already paid for.',
    predictableTitle: 'Predictable revenue',
    predictableBody:
      'You can forecast against a subscriber count. You cannot forecast against footfall.',
    frequencyTitle: 'Higher visit frequency',
    frequencyBody: 'Members come more often, because not coming feels like waste.',
    priceTitle: 'A reason to charge more',
    priceBody:
      'Included balance and an earn multiplier make the price feel like a discount.',
    upsellTitle: 'Turn regulars into subscribers',
    upsellBody:
      'Sell a monthly plan, grant a balance automatically each period, and let members earn faster.',
    newMembership: 'New membership',
    editMembership: 'Edit membership',
    mrr: 'Monthly recurring revenue',
    mrrHint:
      'What your active members bring in every month. Annual plans are divided by twelve.',
    activeMembers: 'Active members',
    renewing30: 'Renewing in 30 days',
    renewing30Hint:
      'Members whose period ends soon. They are reminded three days before, so a charge is never a surprise.',
    lifetimeRevenue: 'Lifetime revenue',
    lifetimeRevenueHint: 'Everything memberships have brought in since you started.',
    tabPlans: 'Plans',
    tabMembers: 'Members',
    empty: 'No memberships yet',
    emptyBody:
      'Start with one. A monthly plan priced at about eight visits’ worth is the shape that works.',
    emptyCta: 'Create your first membership',
    noMembers: 'Nobody has joined yet',
    noMembersBody:
      'Sign your first members up from their customer profile, or at the counter.',
    perMonth: '/month',
    perYear: '/year',
    archivePlan: 'Stop accepting new members',
    archiveLabel: 'Archive {name}',
    editLabel: 'Edit {name}',
    multiplier: '{value}× points',
    includedBalance: '+{count} each period',
    trialDays_one: '{count}-day trial',
    trialDays_other: '{count}-day trial',
    inviteOnly: 'Invite only',
    members: 'Members',
    contributing: 'Contributing',
    perMonthShort: '/mo',
    tableCaption: 'Members',
    columns: {
      member: 'Member',
      plan: 'Plan',
      status: 'Status',
      renews: 'Renews',
      paidSoFar: 'Paid so far',
    },
    removedCustomer: 'Removed customer',
    ending: 'Ending',
    active: 'Active',
    formSubtitle:
      'Price it near what a regular already spends in a fortnight. It should feel like a discount, not a subscription.',
    name: 'Name',
    namePlaceholder: 'Coffee Club',
    description: 'What members get',
    descriptionPlaceholder: 'A coffee a day, double points on everything else.',
    price: 'Price',
    billed: 'Billed',
    monthly: 'Monthly',
    yearly: 'Yearly',
    pointsEachPeriod: 'Points each period',
    pointsEachPeriodHint: 'Granted automatically on renewal',
    earnMultiplier: 'Earn multiplier',
    earnMultiplierHint: 'On top of their tier',
    perks: 'Perks, one per line',
    perksPlaceholder: 'Skip the queue\n10% off beans\nFirst to know about new roasts',
    memberCap: 'Member cap',
    memberCapPlaceholder: 'Leave empty for unlimited',
    memberCapHint:
      'A cap creates scarcity — “only 50 places” sells better than “join any time”.',
    acceptingMembers: 'Accepting new members',
    acceptingMembersHint: 'Existing members are never affected',
    projection: 'At {monthly} a month, 50 members would be {total} of recurring revenue.',
    createCta: 'Create membership',
  },

  campaigns: {
    title: 'Campaigns',
    subtitle: 'One-off messages to a targeted group of customers',
    newCampaign: 'New campaign',
    empty: 'No campaigns yet',
    emptyBodyAi: 'Describe what you want in a sentence and let AI write the first draft.',
    emptyBody: 'Create a message and send it to a segment of your customers.',
    emptyCta: 'Create your first campaign',
    channels: {
      email: 'Email',
      sms: 'SMS',
      whatsapp: 'WhatsApp',
      push: 'Push',
      wallet: 'Wallet',
    },
    aiTag: 'AI',
    stats: {
      sent: 'Sent',
      opened: 'Opened',
      revenue: 'Revenue',
      roi: 'ROI',
    },
    willReach: 'Will reach {count} customers · about {cost}',
    draftNoAudience: 'Draft — no audience chosen yet',
    status: {
      draft: 'Draft',
      scheduled: 'Scheduled',
      sending: 'Sending',
      completed: 'Sent',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    composerSubtitle: 'Choose who it goes to, write it once, and see the cost before you send.',
    briefLabel: 'Describe what you want',
    briefPlaceholder:
      'Bring back customers who have not visited in a month, offer a free coffee',
    generate: 'Write it for me',
    generateFailed: 'We could not generate a campaign',
    saveFailed: 'We could not save the campaign',
    name: 'Campaign name',
    namePlaceholder: 'March win-back',
    untitled: 'Untitled campaign',
    audience: 'Who receives it',
    audiencePlaceholder: 'Choose an audience',
    everyone: 'Everyone',
    segmentCount: '{name} — {count} people',
    reach: '{count} customers',
    reachWithCost: '{count} customers · about {cost} to send',
    channelsLabel: 'Channels',
    channelUnavailable: '{channel} is not configured on this deployment',
    emailSection: 'Email',
    subject: 'Subject',
    body: 'Message',
    personalisation: 'You can use {tokens} to personalise.',
    smsSection: 'SMS',
    smsCount_one: '{characters} characters · {count} segment per recipient',
    smsCount_other: '{characters} characters · {count} segments per recipient',
    smsUnicode: 'Contains special characters, which shortens each segment.',
    saveDraft: 'Save as a draft',
    sendNow: 'Send now',
  },

  automations: {
    title: 'Automations',
    subtitleIdle: 'Set these up once and they work while you serve customers',
    subtitleActive_one: '{count} running for you around the clock',
    subtitleActive_other: '{count} running for you around the clock',
    empty: 'No automations yet',
    emptyBody:
      'Your workspace normally comes with welcome, birthday and win-back automations ready to go.',
    toggleLabel: 'Switch {name} on or off',
    sent30: 'Sent (30 days)',
    allTime: 'All time',
    revenue: 'Revenue',
    skipped_one:
      '{count} skipped — usually consent, quiet hours, or the customer came back on their own.',
    skipped_other:
      '{count} skipped — usually consent, quiet hours, or the customer came back on their own.',
    triggers: {
      customer_joined: 'When someone joins',
      birthday: 'On their birthday',
      anniversary: 'On their anniversary',
      inactivity: 'When they stop coming',
      reward_unlocked: 'When a reward unlocks',
      reward_redeemed: 'After they claim',
      balance_expiring: 'Before points expire',
      tier_upgraded: 'On a tier upgrade',
      nps_promoter: 'After a great review',
      nps_detractor: 'After a bad review',
      visit_recorded: 'On every visit',
      purchase_recorded: 'On every purchase',
      referral_qualified: 'When a referral pays off',
      membership_renewal: 'On a membership renewal',
    },
  },

  growth: {
    title: 'Grow',
    subtitle: 'Your customers are your cheapest marketing channel. This is how you use them.',
    referredCustomers: 'Customers referred',
    referredCustomersHint: 'People who joined because an existing customer sent them.',
    referredRevenue: 'Revenue from referrals',
    referredRevenueHint: 'Lifetime spend of everyone who arrived through a referral.',
    nps: 'Net promoter score',
    npsHint:
      'Promoters minus detractors, as a percentage. Above 50 is excellent for a local business.',
    needsAttention: 'Needs your attention',
    needsAttentionHint: 'Unhappy customers nobody has followed up with yet.',
    tabReferrals: 'Referrals',
    tabReviews: 'Reviews',
    tabShare: 'Share',
    tabPartners: 'Refer a business',
    programTitle: 'Referral rewards',
    programBody:
      'Both sides are rewarded — the friend on signup, the advocate only once the friend actually buys something. That is what stops people referring themselves.',
    programToggleLabel: 'Referral programme active',
    advocateGets: 'The advocate gets',
    advocateGetsHint_one: 'Paid after their friend’s first visit',
    advocateGetsHint_other: 'Paid after their friend’s {count} visits',
    friendGets: 'The friend gets',
    friendGetsHint: 'Straight away, when they join',
    saveRewards: 'Save the rewards',
    noReferrals: 'No referrals yet',
    noReferralsBody:
      'Every customer has a referral code on their card. Print the QR poster and mention it at the counter — that alone usually starts it.',
    advocates: 'Your advocates',
    advocatesSummary: '{qualified} of {total} referrals converted ({rate})',
    advocateConverted: '{qualified} converted of {total} invited',
    broughtIn: 'brought in',
    advocatesNote:
      'These people are worth thanking by name. A free coffee for your top advocate costs less than any advertising, and they will tell everyone about it.',
    reviewLoop: 'The review loop',
    reviewLoopBody:
      'Happy customers are pointed at your public review page. Unhappy ones come to you first, so you can fix it before they write anything. Nobody is stopped from reviewing — we simply do not ask someone for a five-star review thirty seconds after they told us they were unhappy.',
    promoters: 'Promoters',
    passives: 'Passives',
    detractors: 'Detractors',
    clickedThrough: 'Clicked through to review',
    distributionLabel: 'Score distribution',
    noReviewLink:
      'You have not set a Google review link yet, so promoters have nowhere to go.',
    addItInSettings: 'Add it in Settings',
    nothingToFix: 'Nothing needs fixing',
    nothingToFixBody: 'No unhappy customers are waiting on a reply. That is the goal.',
    unresolved: 'Unhappy customers waiting on you',
    unresolvedBody:
      'A customer who complains and gets a reply is more loyal than one who never complained.',
    aCustomer: 'A customer',
    markHandled: 'Mark as handled',
    resolutionLabel: 'What did you do about it? This is saved to their profile so your team knows.',
    resolutionPlaceholder:
      'Called her, apologised for the wait, gave her a free coffee next visit.',
    yourLinks: 'Your links',
    joinLink: 'Join your loyalty program',
    joinLinkNote: 'Put this on the counter, on receipts, in your Instagram bio.',
    giftLink: 'Buy a gift card',
    giftLinkNote: 'Share this in December and watch what happens.',
    openLink: 'Open {label}',
    counterQr: 'Counter QR code',
    counterQrBody: 'A high-resolution PNG, ready to print at any size.',
    qrAlt: 'QR code linking to your join page',
    whatToSay: 'What to actually say',
    say1: '“Scan this and your next one is on its way to being free.” — at the till, every time.',
    say2: 'Put the QR on the receipt. It costs nothing and it is already in their hand.',
    say3: 'Post the gift card link once a week in December.',
    say4: 'When a regular brings a friend, mention that they both get something for it.',
    partnersUnavailable: 'Not available',
    partnersUnavailableBody: 'No referral code is available for this workspace.',
    referBusiness: 'Know another business that needs this?',
    referBusinessBody:
      'Send them your link. When they start paying, you get {credit} of credit on your next invoice and they get an extended trial. There is no limit on how many.',
    copyLink: 'Copy the link',
    businessesReferred: 'Businesses referred',
    creditEarned: 'Credit earned',
    stillOnTrial: 'Still on trial',
    whoYouSent: 'Who you have sent',
    trialling: 'Trialling',
  },

  network: {
    title: 'Partner network',
    subtitle: 'Swap customers with the businesses around you',
    howItWorks: 'How this works',
    howItWorksBody:
      'The gym next door has 400 members who do not know you exist. You have 600 who have never been to the gym. Partner up, publish an offer to each other’s members, and both of you get in front of an audience that already trusts a local business.',
    rule1: 'Nobody’s customer list is ever shared. You publish offers; we deliver them.',
    rule2: 'Both sides have to agree, and either can end it instantly.',
    rule3: 'You see exactly how many customers each partnership actually sent you.',
    upsellTitle: 'Join the local network',
    upsellBody:
      'Partner with nearby businesses and put your offer in front of their members.',
    listed: 'You are listed in the network',
    listedBody:
      'Businesses in {city} can find you and send a partnership request. You approve every one.',
    yourArea: 'your area',
    notListed: 'Join the local network',
    notListedBody:
      'Nothing is shared until you switch this on, and nothing about your customers is ever shared at all.',
    participationLabel: 'List my business in the partner network',
    bio: 'How other businesses see you',
    bioPlaceholder:
      'Specialty coffee roaster on Calle Mayor. Busiest 8–11am, mostly office workers.',
    saveBio: 'Save the description',
    invitations_one: '{count} invitation waiting',
    invitations_other: '{count} invitations waiting',
    accept: 'Accept',
    decline: 'Decline',
    tabPartners: 'Partners ({count})',
    tabDiscover: 'Discover',
    tabOffers: 'Offers',
    noPartners: 'No partners yet',
    noPartnersBody:
      'Find a business nearby whose customers would like what you sell. A café and a bookshop is a better pairing than two cafés.',
    searchPlaceholder: 'Search businesses near you',
    searchLabel: 'Search the directory',
    nobodyNearby: 'Nobody nearby yet',
    nobodyNearbyBody:
      'You are early. As more local businesses join they will appear here — and the businesses you referred show up first.',
    ourOffers: 'Offers you publish',
    newOffer: 'New offer',
    ourOffersEmpty: 'Publish an offer and your partners’ members can claim it.',
    partnerOffers: 'Offers from your partners',
    partnerOffersEmpty:
      'Nothing yet. Your partners’ offers appear here and can be claimed at your counter.',
    endPartnership: 'End',
    theySentYou: 'They sent you',
    youSentThem: 'You sent them',
    noTraffic: 'No traffic yet. Publish an offer — a partnership with no offer does nothing.',
    partners: 'Partners',
    pending: 'Pending',
    invite: 'Invite',
    fromBusiness: 'from {name}',
    claimedOf: 'Claimed {count} of {limit}',
    claimedTimes_one: 'Claimed {count} time',
    claimedTimes_other: 'Claimed {count} times',
    offerTitle: 'New partner offer',
    offerEditTitle: 'Edit the offer',
    offerSubtitle:
      'Make it worth walking for. “10% off” moves nobody; “a free coffee with your gym membership” does.',
    offerLabel: 'Offer',
    offerPlaceholder: 'Free coffee for gym members',
    offerDetails: 'Details',
    offerDetailsPlaceholder:
      'Show your gym card at the counter. Any drink up to a large latte.',
    whoCanClaim: 'Who can claim it',
    anyPartner: 'Members of any partner',
    onlyPartner: '{name} only',
    totalClaims: 'Total claims',
    totalClaimsPlaceholder: 'Leave empty for unlimited',
    totalClaimsHint: 'A cap protects your margin and creates urgency at the same time.',
    publishOffer: 'Publish the offer',
  },

  analytics: {
    title: 'Analytics',
    subtitle: 'How your loyalty program is actually performing',
    range7: 'Last 7 days',
    range30: 'Last 30 days',
    range90: 'Last 90 days',
    range365: 'Last year',
    repeatRate: 'Repeat purchase rate',
    repeatRateHint:
      'Members who have visited more than once. The single best measure of whether loyalty is working.',
    retention: 'Retention (30 days)',
    retentionHint: 'Members active in the last 30 days as a share of all members.',
    churn: 'Churn',
    churnHint: 'Members with no visit in 60+ days.',
    clv: 'Customer lifetime value',
    clvHint: 'Average total recorded spend per member.',
    averageTicket: 'Average ticket',
    visits: 'Visits',
    rewardsClaimed: 'Rewards claimed',
    outstanding: 'Outstanding balance',
    outstandingHint:
      'Points and stamps your customers hold but have not spent. This is a liability.',
    monthlyGrowth: 'Monthly growth',
    monthlyGrowthBody: 'New members and visits by month',
    newMembers: 'New members',
    notEnoughHistory: 'Not enough history yet',
    notEnoughHistoryBody:
      'Once you have a month of activity this chart shows how you are growing.',
    cohorts: 'Cohort retention',
    cohortsBody:
      'Of the people who joined each month, how many were still coming back later',
    cohortJoined: 'Joined',
    cohortSize: 'Size',
    cohortMonth: 'M{index}',
    topRewards: 'Most claimed rewards',
    topRewardsEmpty: 'No rewards were claimed in this period.',
    topCustomers: 'Highest-value members',
    topCustomersEmpty: 'No members yet.',
  },

  insights: {
    title: 'AI insights',
    subtitle: 'What your numbers are telling you',
    subtitleImpact: 'Up to {amount} on the table right now',
    notConfigured: 'AI is not configured',
    notConfiguredBody:
      'Add an Anthropic API key to this deployment to unlock campaign generation, churn prediction and daily business insights.',
    refresh: 'Refresh the insights',
    empty: 'No insights yet',
    emptyBody:
      'Insights are generated nightly from your activity. Generate a set now to see what stands out.',
    generate: 'Generate insights',
    generating: 'Analysing…',
    dismiss: 'Dismiss this insight',
    potential: '{amount} potential',
    confidence: '{percent} confidence · {date}',
    severity: {
      info: 'Information',
      opportunity: 'Opportunity',
      warning: 'Warning',
      critical: 'Critical',
    },
    kinds: {
      churn_risk: 'Churn risk',
      revenue_opportunity: 'Revenue opportunity',
      program_health: 'Program health',
      campaign_idea: 'Campaign idea',
      customer_segment: 'Customer segment',
      operations: 'Operations',
    },
  },

  settings: {
    title: 'Settings',
    subtitle: 'Your business, your card, your team',
    tabBusiness: 'Business',
    tabCard: 'Card',
    tabSignup: 'Sign-up',
    tabTeam: 'Team',
    businessDetails: 'Business details',
    name: 'Business name',
    city: 'City',
    phone: 'Phone',
    supportEmail: 'Support email',
    website: 'Website',
    googleReviewUrl: 'Google review link',
    googleReviewUrlHint: 'Where happy customers are sent after a great rating',
    currency: 'Currency',
    language: 'Language',
    messagingRules: 'Messaging rules',
    messagingRulesBody:
      'These protect your list. Over-messaging is the fastest way to lose customers.',
    quietStart: 'Quiet hours start',
    quietEnd: 'Quiet hours end',
    weeklyCap: 'Most messages per week',
    weeklyCapHint: 'Per customer, across every channel',
    saveRules: 'Save the rules',
    channels: 'Channels & integrations',
    channelsBody:
      'What this deployment can currently do. Anything switched off is a missing credential, not a missing feature.',
    channelEmail: 'Email',
    channelSms: 'SMS',
    channelWhatsapp: 'WhatsApp',
    channelAppleWallet: 'Apple Wallet',
    channelGoogleWallet: 'Google Wallet',
    channelAi: 'AI features',
    channelBilling: 'Billing',
    noteResend: 'Resend',
    noteTwilio: 'Twilio',
    noteMeta: 'Meta Cloud API',
    noteApple: 'Pass signing certificates',
    noteGoogle: 'Service account',
    noteAnthropic: 'Anthropic',
    noteStripe: 'Stripe',
    cardDesign: 'Card design',
    cardDesignBody: 'This is what your customers see in Apple Wallet and Google Wallet.',
    cardDesignBullets: {
      templates: 'Eleven starting points, from Minimal to Luxury',
      colors: 'Your own colours, with legibility checked as you pick',
      logo: 'Your logo, uploaded from your phone or laptop',
      fields: 'Choose what the card shows: stamps, tier, store, your own words',
    },
    openCardDesigner: 'Open the card designer',
    previewMember: 'Ana García',
    signupLink: 'Your sign-up link',
    signupLinkBody: 'Print this QR code and put it on the counter. That is the whole setup.',
    qrAlt: 'QR code to join {name}',
    copyLink: 'Copy the link',
    signupNote:
      'Customers scan, enter their email, and their card is on their phone in about fifteen seconds. There is no app to install.',
    team: 'Team',
    teamBody: 'Staff can record visits and redeem rewards. Managers can also run campaigns.',
    teamMember: 'Team member',
    invitationPending: 'Invitation pending',
    lastActive: 'Last active {date}',
    neverSignedIn: 'Never signed in',
    roles: {
      owner: 'Owner',
      admin: 'Administrator',
      manager: 'Manager',
      staff: 'Staff',
      viewer: 'Viewer',
    },
    palette: {
      midnight: 'Midnight',
      espresso: 'Espresso',
      sage: 'Sage',
      rose: 'Rose',
      ink: 'Ink',
      ocean: 'Ocean',
    },
  },

  billing: {
    title: 'Plan & billing',
    subtitle: 'What you are on, what you are using, and what more would get you',
    checkoutSuccess: 'You are all set',
    checkoutSuccessBody: 'Your plan is active. It can take a few seconds to appear below.',
    checkoutFailed: 'We could not start the checkout',
    portalFailed: 'We could not open the billing portal',
    trialBadge_one: 'Trial — {count} day left',
    trialBadge_other: 'Trial — {count} days left',
    paymentFailed: 'Payment failed',
    endsOn: 'Ends {date}',
    endsAtPeriodEnd: 'Ends at the end of the period',
    trialBody:
      'You have full access while you try everything out. No card is needed until it ends.',
    cancellingBody:
      'Your plan stays active until the end of the period. Nothing is deleted after that.',
    delinquentBody:
      'Your current plan stays available while we sort the payment out. Update your card to keep everything running normally.',
    renewsOn: 'Renews {date}',
    referralCredit: '{amount} of referral credit applies to your next invoice.',
    invoices: 'Invoices & payment',
    delinquentWarning:
      'We could not take payment. Update your card or reactivate your plan to keep every wallet pass, QR code and scan working. Your customers and history stay safe either way.',
    dunningTitle: 'What happens if a payment fails',
    dunningBody:
      'We retry the charge and email you before anything changes. Nothing is deleted, and your data stays exactly where it is.',
    usage: 'Usage',
    usageBody:
      'Monthly counters reset on the first. Nobody is ever turned away at the counter because of a limit.',
    usageUnlimited: 'Your plan has no limits. Use as much as you need.',
    plans: 'Plans',
    plansBody:
      'Every plan includes wallet cards, the point of sale and unlimited staff scans.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    twoMonthsFree: '2 months free',
    notConfigured:
      'Online checkout is not configured on this deployment. Plans are shown for reference; contact us to change yours.',
    mostPopular: 'Most popular',
    yourPlan: 'Your plan',
    custom: 'Custom',
    annualSaving: 'Save {amount} a year',
    currentPlan: 'Current plan',
    talkToUs: 'Talk to us',
    contactUnavailable: 'Contact us for pricing',
    choosePlan: 'Choose {plan}',
    included: 'Included',
    unavailable: 'Unavailable',
    features: {
      campaigns: 'Campaigns',
      automations: 'Automations',
      gift_cards: 'Gift cards',
      memberships: 'Paid memberships',
      ai: 'AI features',
      advanced_analytics: 'Advanced analytics',
      segments: 'Saved segments',
      api_access: 'REST API',
      webhooks: 'Webhooks',
      coalition: 'Partner network',
      multi_location: 'Multiple locations',
      custom_branding: 'Custom branding',
      priority_support: 'Priority support',
      sso: 'Single sign-on',
      team_management: 'Team management',
      wallet_proximity: 'Location-aware wallet passes',
      geofencing: 'Geofencing',
      proximity_campaigns: 'Proximity campaigns',
      automation_rules: 'Automation rule builder',
    },
    limits: {
      customers: 'Customers',
      locations: 'Locations',
      team_members: 'Team members',
      messages_per_month: 'Messages this month',
      ai_actions_per_month: 'AI actions this month',
      campaigns_per_month: 'Campaigns this month',
      proximity_campaigns: 'Proximity campaigns',
      automation_rules: 'Automation rules',
    },
  },

  /**
   * The plan catalogue's merchant-facing copy.
   *
   * `lib/billing/plans.ts` holds the *shape* of a tier — prices, features, caps —
   * and points at these keys for the words. The tier names themselves stay in the
   * catalogue: "Growth" is what the merchant sees on their invoice, in both
   * languages.
   */
  plans: {
    lapsed: {
      tagline: 'Your data is safe. Reactivate any time to start serving again.',
    },
    starter: {
      tagline: 'A real digital loyalty program for less than two coffees a month.',
      h1: 'Stamp and points cards in Apple Wallet & Google Wallet',
      h2: 'Built-in QR scanner — any phone, tablet or laptop',
      h3: 'One location, up to 500 customers',
      h4: 'Your logo and colours on every card',
      h5: 'Location-aware passes on the lock screen',
    },
    growth: {
      tagline: 'Bring customers back on purpose, not by luck.',
      h1: 'Everything in Starter, up to 5,000 customers',
      h2: 'Up to 5 locations with per-site reporting',
      h3: 'Geofenced wallet notifications when customers walk past',
      h4: 'Email, SMS and WhatsApp campaigns',
      h5: 'Always-on automations: welcome, birthday, win-back',
      h6: 'Customer segments and the no-code rule builder',
    },
    pro: {
      tagline: 'The AI marketing team you do not have to hire.',
      h1: 'Everything in Growth, up to 25,000 customers',
      h2: 'AI campaigns, insights and customer summaries',
      h3: 'Paid memberships — your own recurring revenue',
      h4: 'Churn prediction, lifetime value and cohort retention',
      h5: 'REST API, webhooks and custom branding',
      h6: 'Up to 15 locations',
    },
    business: {
      tagline: 'For groups, franchises and anything with more than one manager.',
      h1: 'Unlimited customers, locations and team members',
      h2: 'Team management with roles and per-site staff',
      h3: 'Partner network — swap customers with nearby businesses',
      h4: 'Single sign-on and priority support',
      h5: 'Unlimited proximity campaigns and automation rules',
      h6: 'Migration handled by us',
    },
  },

  pos: {
    dialogTitle: 'Scan a customer',
    dialogDescription:
      'Point the camera at a customer’s wallet pass, loyalty card, reward code or gift card. You can also find them by name.',
    noAccess: 'No access',
    noAccessBody: 'Your role cannot serve customers here. Ask an owner or manager for access.',
    backToDashboard: 'Back to the dashboard',
    scan: 'Scan',
    served_one: '{count} served',
    served_other: '{count} served',
    closeScanner: 'Close the scanner',
    offline: 'Offline — scans are being saved',
    syncing_one: 'Syncing {count} saved scan',
    syncing_other: 'Syncing {count} saved scans',
    torchOn: 'Turn the light on',
    torchOff: 'Turn the light off',
    soundOn: 'Play a sound on each scan',
    soundOff: 'Mute the scan sound',
    switchCamera: 'Switch camera',
    cameraPreview: 'Camera preview',
    reading: 'Reading…',
    pointCamera: 'Point the camera at a wallet pass, or tap a name below',
    reconnecting: 'The camera is reconnecting after a pause.',
    opening: 'Opening the camera…',
    retryCamera: 'Try the camera again',
    queuedOffline: 'Saved offline. It will sync when you are back online.',
    scanFailed: 'That scan could not be processed.',
    abandoned_one: '{count} saved scan could not sync',
    abandoned_other: '{count} saved scans could not sync',
    abandonedBody: '{names}. Record these visits manually.',
    unknownCustomer: 'Unknown customer',
    ticketAmount: 'Ticket amount',
    clearAmount: 'Clear the ticket amount',
    ticketNote:
      'The next scan is recorded as a {amount} purchase and appears in your dashboard as soon as it syncs.',
    backToCamera: 'Back to the camera',
    searchInstead: 'No code? Search for a customer by name',
    readyForNext: 'Ready for the next customer',
    dismissResult: 'Dismiss',
    duplicate: 'Already recorded a moment ago',
    identified: 'Identified',
    identifiedNoEarn: 'Identified — your role cannot record visits',
    awarded: '+{amount} {unit}',
    visitsCount_one: '{count} visit',
    visitsCount_other: '{count} visits',
    rewardReady: 'Reward ready',
    toGo: '{count} to go',
    progressLabel: 'Progress towards the reward: {balance} of {goal} {unit}',
    queuedBalance: 'Saved on this device — the balance shown updates when it syncs.',
    waitingHandover: 'Waiting to be handed over',
    redeem: 'Redeem {name}',
    redeemed: '{name} redeemed — hand it over.',
    redeemFailed: 'We could not redeem that',
    giftCardBalance: 'Gift card balance: {amount}',
    partnerOffer: 'Partner offer available: {title}',
    partnerOfferFrom: 'Partner offer available: {title} ({business})',
    giveThem: 'Give them the {name}',
    handedOver: 'marked as handed over',
    giftCardCode: 'Gift card {code}',
    giftCardFor: 'for {name}',
    amountToTake: 'Amount to take',
    wholeBalance: 'The whole balance ({amount})',
    take: 'Take {amount}',
    taken: '{amount} taken',
    leftOnCard: '{amount} left on the card',
    cardEmpty: 'The card is now empty',
    cannotTakePayment: 'Your role cannot take payment from gift cards.',
    takeFailed: 'We could not take payment',
    referralFrom: 'Referral from {name}',
    referralBody:
      'Code {code}. Sign the new customer up and {name} gets their reward automatically on the friend’s first visit.',
    whichOne: 'Which one? · “{term}”',
    reward: 'Reward',
    notAMember: 'Not a member yet',
    notAMemberBody:
      'That is a sign-up code for {slug}. Ask them to open it on their phone, or add them from the Customers screen.',
    notRecognised: 'Not recognised',
    searchLabel: 'Name, phone, email or code',
    searchPlaceholder: 'Start typing…',
    tabRecent: 'Recent',
    tabRegulars: 'Regulars',
    noMatches: 'Nobody matches that. Check the spelling, or press Enter to try it as a code.',
    noRecent: 'No visits recorded yet. Search for a customer by name.',
    noRegulars: 'No regulars marked yet. Star your best customers to find them here.',
    neverVisited: 'never visited',
  },

  /**
   * The post-onboarding checklist.
   *
   * Everything the wizard deliberately stopped asking for. Each row links to the
   * screen that does it, so deferring a decision is never the same as losing it.
   */
  checklist: {
    title: 'First steps',
    subtitle: 'A few minutes each, whenever it suits you. Nothing here blocks the counter.',
    dismiss: 'Hide this checklist',
    dismissed: 'Hidden. You can bring it back from Settings.',
    restore: 'Show the checklist again',
    progress: '{done} of {total} done',
    allDone: 'That is everything. Your setup is complete.',
    items: {
      locations: 'Add your other locations',
      locationsBody: 'Per-site opening hours, geofences and reporting.',
      proximity: 'Switch on proximity notifications',
      proximityBody: 'Your card comes back to customers when they walk past the door.',
      branding: 'Personalise the card',
      brandingBody: 'Your logo, your colours, your lock-screen wording.',
      firstScan: 'Serve your first customer',
      firstScanBody: 'Open the scanner and check somebody in — it takes about a minute.',
      campaign: 'Send your first campaign',
      campaignBody: 'A welcome offer to everyone who has joined so far.',
      team: 'Invite your team',
      teamBody: 'Staff can scan and redeem without seeing your billing.',
    },
  },

  /**
   * Merchant-facing copy produced with no request behind it.
   *
   * A dunning email is sent by a webhook, an overage warning by somebody else's
   * scan, a renewal notice by a cron job. None of them has a viewer whose cookie
   * could say what language to use, so they resolve `businesses.locale` instead
   * — see `lib/i18n/business.ts`. Without this namespace those are the last
   * English strings a Spanish merchant would ever be sent.
   */
  notify: {
    softLimitTitle: 'You have outgrown your {plan} plan',
    softLimitBody: '{limit}: {used} of {allowed}. We are still signing everyone up — nobody is being turned away.',
    softLimitBodyUpgrade:
      '{limit}: {used} of {allowed}. We are still signing everyone up — nobody is being turned away. {plan} raises the limit.',
    subscriptionEndedTitle: 'Your subscription has ended',
    subscriptionEndedBody:
      'Your workspace is inactive. Every customer, card and campaign is still here — reactivate whenever you are ready.',
    planActiveTitle: 'You are on {plan}',
    planActiveBody: 'Everything in your plan is unlocked. Good to have you.',
    paymentFailedTitle: 'We could not take payment',
    paymentFailedBody:
      'Your card was declined. We will try again — update it in billing and nothing changes.',
    paymentRecoveredTitle: 'Your payment went through',
    paymentRecoveredBody: 'Thank you. Your plan is fully active again.',
    subscriptionLapsedTitle: 'Your plan is paused',
    subscriptionLapsedBody:
      'After several attempts we could not take payment, so writes are paused. Nothing has been deleted — reactivate and everything comes straight back.',

    /*
     * Partnership, sales and service-recovery alerts. These land in a
     * merchant's own notification tray, so they resolve against that
     * merchant's language — the *recipient's*, which for an invitation is the
     * invited business rather than the one that sent it.
     */
    partnershipInviteTitle: 'A local business wants to partner',
    partnershipInviteBody:
      '{business} invited you to swap customers. Nothing is shared until you accept.',
    partnershipInviteFallback: 'A nearby business',
    partnershipAcceptedTitle: 'Your partnership was accepted',
    partnershipAcceptedBody: 'You can now publish offers to each other’s members.',
    giftCardSoldTitle: 'Gift card sold — {amount}',
    giftCardSoldForBody: 'Bought for {name}. That is money in the till today.',
    giftCardSoldBody: 'Paid online. That is money in the till today.',
    serviceRecoveryBody: 'Service recovery (scored {score}): {note}',
  },

  /**
   * Transactional emails written by the platform rather than by the merchant.
   *
   * Deliberately plain: a payment problem is not the moment for marketing voice,
   * and every one of these says what happened, what we will do next, and what
   * they need to do — in that order.
   */
  emails: {
    /**
     * The frame every outbound email is wrapped in.
     *
     * The shell hardcoded `lang="es"` on every message ever sent while its own
     * footer link said "Unsubscribe" in English — so a Spanish café's customers
     * got a Spanish body with an English footer, and an English merchant's
     * customers got a correct body inside a frame every screen reader announced
     * as Spanish. Both halves are resolved from the business's locale now.
     */
    shell: {
      unsubscribe: 'Unsubscribe',
      poweredBy: 'Powered by {product}',
      openCta: 'Open',
    },
    /**
     * Gift card delivery and receipt.
     *
     * A gift card is bought by one person and read by another, and both emails
     * were English literals with `en-GB` money and dates — the single most
     * customer-visible thing a merchant can sell through the product.
     */
    giftCard: {
      sentSubject: '{sender} sent you a {amount} gift card',
      receivedSubject: 'You have a {amount} gift card',
      greetingNamed: 'Hi {name},',
      greeting: 'Hi,',
      fromSender: '{sender} bought you a gift card for {business}.',
      fromNobody: 'You have a gift card for {business}.',
      codeLine: 'Your code is {code} and it is worth {amount}.',
      showAtCounter: 'Show it at the counter — no app, no account, nothing to print.',
      validUntil: 'Valid until {date}.',
      noExpiry: 'It does not expire.',
      seeShop: 'See the shop',
      receiptSubject: 'Your {amount} gift card for {business}',
      receiptHeading: 'Gift card confirmed',
      receiptThanks: 'Thank you — your {amount} gift card for {business} is confirmed.',
      receiptScheduled: 'It will be emailed to {recipient} on {date}.',
      receiptSent: 'It has been emailed to {recipient}.',
      receiptCode: 'The code is {code}, in case you would rather hand it over yourself.',
    },
    /** Fallback wording for the membership renewal reminder's merge fields. */
    membership: {
      planFallback: 'membership',
    },
    dunning: {
      firstSubject: 'We could not take your payment for {business}',
      firstBody:
        'Your card was declined, so your {plan} subscription could not renew. We will try again in a few days — nothing changes in the meantime and none of your data is affected. If the card has expired or moved bank, updating it now saves the retry.',
      retrySubject: 'Still unable to take payment for {business}',
      retryBody:
        'We tried your card again and it was declined. Attempt {attempt} of {maxAttempts}. Your workspace is working normally and every customer, card and campaign is untouched. Updating your payment details clears this immediately.',
      finalSubject: 'Last attempt before {business} is paused',
      finalBody:
        'This is the final retry. If it fails, your workspace moves to the inactive state: your data stays exactly where it is and every screen keeps working, but new customers, campaigns and changes are paused until a payment succeeds.',
      lapsedSubject: '{business} is now paused',
      lapsedBody:
        'We could not take payment after several attempts, so your workspace is paused. Nothing has been deleted: every customer, card, campaign and scan is still here, and reactivating brings all of it straight back.',
      recoveredSubject: 'Payment received — {business} is fully active',
      recoveredBody:
        'Your payment went through and everything is back to normal. Thank you, and sorry for the interruption.',
      cta: 'Update payment details',
      ctaReactivate: 'Reactivate my plan',
    },
  },

  errors: {
    notFound: 'Not found',
    notFoundBody: 'The page you were looking for is not here.',
    forbidden: 'You do not have access to this',
    forbiddenBody: 'Ask an owner or admin of this workspace to give you access.',
    paymentRequired: 'Your plan does not include this',
    offline: 'You are offline',
    offlineBody:
      'Keep serving customers — scans are queued on this device and sent the moment you are back online. No visit is lost.',
    validation: 'Please check the highlighted fields.',
    /**
     * Client-side renderings of the API error envelope.
     *
     * The API answers in one language because it has no view; the merchant reads
     * the answer in theirs. Mapping `error.code` here is what stops an English
     * sentence from the server landing in a Spanish toast.
     */
    api: {
      unauthorized: 'Your session has expired. Sign in again.',
      forbidden: 'Your role does not allow that.',
      not_found: 'We could not find that.',
      conflict: 'That has already been done.',
      rate_limited: 'Too many requests. Wait a moment and try again.',
      payment_required: 'Your plan does not include that.',
      not_configured: 'That is not configured on this deployment yet.',
      internal_error: 'Something went wrong on our side. Please try again.',
      network: 'We could not reach the server. Check your connection and try again.',
      upgradeFeature: '{feature} is available from {plan}.',
      upgradeLimit: 'Your plan includes {allowed} {limit}. You are using {used}.',
      upgradeLapsed: 'Your subscription is inactive. Reactivate to do that — nothing has been deleted.',
    },
  },
} as const

/**
 * The dictionary contract: the same tree, with every leaf widened to `string`.
 *
 * Widening matters. Typing another locale as `typeof en` would demand the *English
 * words*, which is nonsense; typing it as `Record<string, unknown>` would demand
 * nothing, which is how a key goes missing. `DictionaryShape` demands the same keys
 * with translated values — so `pnpm typecheck` is what enforces "no mixed
 * languages", rather than someone remembering.
 */
type Translated<T> = {
  [K in keyof T]: T[K] extends string ? string : Translated<T[K]>
}

export type Dictionary = Translated<typeof en>

/**
 * Any translatable key, as a dotted string.
 *
 * Plural pairs are stored as `key_one` / `key_other` but *called* as `key` with a
 * `count`, so the base name has to be valid too — `PluralBase` strips the suffix and
 * unions it back in. Without that, `t('card.toGo', { count })` would be a type error
 * for the one construct that most needs the type system's help.
 */
export type TranslationKey = PluralBase<LeafPaths<Dictionary>>

type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

type PluralBase<K extends string> = K extends `${infer Base}_one`
  ? Base | K
  : K extends `${infer Base}_other`
    ? Base | K
    : K
