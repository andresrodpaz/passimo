import { ImageResponse } from 'next/og'

/**
 * The favicon.
 *
 * Generated rather than shipped as a binary so it cannot drift from
 * `components/brand-mark.tsx`: the glyph below is the same three strokes the
 * in-app logo draws. A favicon is the one piece of branding that appears in a
 * merchant's tab strip all day, and it used to be the letter "F" — left over
 * from the previous name, and the sort of detail that quietly tells a visitor
 * the rename was not finished.
 */

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // The product's ink, not a gradient: the mark has to stay legible at
          // 16px in a tab, where a two-colour wash turns to mud.
          background: '#1c1917',
          borderRadius: 7,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fefdfb"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 20V6a2 2 0 0 1 2-2h12" />
          <path d="M4 12h11" />
          <circle cx="17" cy="16" r="4" />
        </svg>
      </div>
    ),
    size
  )
}
