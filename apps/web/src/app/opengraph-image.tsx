import { ImageResponse } from 'next/og';

export const alt = 'PharmaFlow — pharmaceutical distribution, stock and traceability';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The Open Graph card.
 *
 * Generated rather than uploaded, so it cannot drift from the brand and there is
 * no binary asset to keep in step with the CSS.
 *
 * Two constraints learned the hard way, both from a build that failed:
 *
 * 1. The capsule is built from divs, not inline SVG. satori has no SVG renderer
 *    and fails the prerender on an <svg> element rather than skipping it.
 *    borderRadius + rotate gives the same geometry as the header mark, and the
 *    same shape stays true in both places.
 *
 * 2. This card is English-only. Satori resolves glyphs against the fonts it has,
 *    and the Arabic string that was here first failed the build with
 *    "lookupType: 5 - substFormat: 3 is not yet supported" -- an OpenType
 *    shaping failure on glyphs no bundled font contains. The interface is
 *    bilingual; a social card is a single image read by whatever client renders
 *    it, and the logo plus the Latin wordmark identify it on its own.
 *
 * A localised card is the right answer eventually and needs a real Arabic subset
 * loaded into the edge runtime, not a string swap.
 */
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
          {/* The capsule: a rounded bar, rotated, with one half inset in white. */}
          <div
            style={{
              width: 34,
              height: 19,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #22b8c4 0%, #0e7f8c 100%)',
              transform: 'rotate(45deg)',
              display: 'flex',
            }}
          >
            <div
              style={{
                width: 15,
                height: '100%',
                background: 'rgba(255,255,255,0.92)',
                borderRadius: '10px 0 0 10px',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 40,
              color: '#ffffff',
              letterSpacing: -0.5,
            }}
          >
            Pharma
            <span style={{ color: '#22b8c4' }}>Flow</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 68,
              color: '#ffffff',
              lineHeight: 1.15,
              maxWidth: 940,
            }}
          >
            Pharmaceutical distribution, tracked lot by lot.
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>
            Inventory · Requisitions · Deliveries
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
