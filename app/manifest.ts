import type { MetadataRoute } from 'next'

/**
 * PWA manifest.
 *
 * The promise is "install nothing, buy nothing", and a merchant who adds this to
 * their home screen gets the till as an app — full screen, one tap from the lock
 * screen, no browser chrome eating the viewport — on hardware they already own.
 *
 * `start_url` is the scanner rather than the dashboard: a device pinned to the
 * counter has exactly one job.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Passimo — Loyalty',
    short_name: 'Passimo',
    description:
      'Turn every visit into a relationship with wallet loyalty, CRM and smart rewards.',
    start_url: '/pos',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fefdfb',
    theme_color: '#fefdfb',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-light-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcuts: [
      { name: 'Scan a customer', short_name: 'Scan', url: '/pos' },
      { name: 'Customers', short_name: 'Customers', url: '/dashboard/customers' },
    ],
  }
}
