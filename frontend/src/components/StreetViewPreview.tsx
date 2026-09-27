import { useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import { bearing } from '../geo'
import type { LatLng } from '../types'

/** Street View panorama taken near `target` and turned to face it. */
export function StreetViewPreview({ target }: { target: LatLng }) {
  const lib = useMapsLibrary('streetView')
  const ref = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{ key: string; ok: boolean }>()
  const key = `${target.lat},${target.lng}`

  useEffect(() => {
    if (!lib || !ref.current) return
    let cancelled = false

    new lib.StreetViewService()
      .getPanorama({ location: target, radius: 60, source: google.maps.StreetViewSource.OUTDOOR })
      .then(({ data }) => {
        const pano = data.location
        if (cancelled || !ref.current || !pano?.latLng || !pano.pano) return
        new lib.StreetViewPanorama(ref.current, {
          pano: pano.pano,
          pov: { heading: bearing(pano.latLng.toJSON(), target), pitch: -5 },
          disableDefaultUI: true,
          clickToGo: false,
          showRoadLabels: false,
          motionTracking: false,
        })
        setResult({ key, ok: true })
      })
      .catch(() => !cancelled && setResult({ key, ok: false }))

    return () => {
      cancelled = true
    }
  }, [lib, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = result?.key === key ? (result.ok ? 'ok' : 'none') : 'loading'

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-high">
      <div ref={ref} className="absolute inset-0" />
      {status !== 'ok' && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">
          {status === 'loading' ? 'Loading Street View…' : 'No Street View imagery here'}
        </div>
      )}
    </div>
  )
}
