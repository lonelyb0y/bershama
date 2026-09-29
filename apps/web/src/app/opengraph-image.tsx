import { ImageResponse } from 'next/og';

/**
 * The Open Graph card.
 *
 * Generated rather than uploaded, so it cannot drift from the brand and there is
 * no binary asset to keep in step with the CSS. The only thing hard-coded is the
 * capsule geometry, and it is duplicated from components/logo.tsx on purpose:
 * next/og renders in an edge runtime with no access to the React tree, and a
 * shared constant across two runtimes is a worse trade than a shape written
 * twice.
 */
export const alt = 'PharmaFlow — pharmaceutical distribution, stock and traceability';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0b1220',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <g transform="rotate(45 16 16)">
              <rect x="7" y="11" width="18" height="10" rx="5" fill="#22b8c4" />
              <path d="M12 11h5v10h-5a5 5 0 0 1 0-10Z" fill="#ffffff" fillOpacity="0.92" />
            </g>
          </svg>
          <div style={{ display: 'flex', fontSize: 40, color: '#ffffff', letterSpacing: -0.5 }}>
            Pharma<span style={{ color: '#22b8c4' }}>Flow</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', fontSize: 72, color: '#ffffff', lineHeight: 1.1, maxWidth: 900 }}>
            Pharmaceutical distribution, tracked lot by lot.
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>
            Inventory · Requisitions · Deliveries — English and العربية
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
