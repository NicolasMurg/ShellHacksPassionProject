import type { ReactNode, SVGProps } from 'react'

// One consistent icon set (24×24, rounded 1.8px strokes, currentColor), used
// instead of emoji so icons match the theme: muted when idle, teal when active.

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

// Walking pace
export const TurtleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 16a7.5 6.5 0 0 1 15 0Z" />
    <path d="M8 16l2-4.5h4l2 4.5M11.5 9.6v2" />
    <path d="M19 14.5h1.2a1.6 1.6 0 0 0 0-3.2H19" />
    <path d="M6.5 16v2M16.5 16v2" />
  </Icon>
)

export const WalkIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="13" cy="4.2" r="1.7" />
    <path d="M12.5 7.5 10.5 12l3 2.2V20" />
    <path d="M11.2 8.8 8.5 11M12.6 8.2l2.6 2.6" />
    <path d="M10.5 12 8.4 19.5" />
  </Icon>
)

export const RunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="15.5" cy="4.2" r="1.7" />
    <path d="M14.5 7.5 11.5 11.5l3.5 2-1 6" />
    <path d="M14.5 7.5l2.6 3h3M11.5 11.5 8.5 12.5" />
    <path d="M11.5 11.5 8.5 18" />
    <path d="M2.5 9h3.5M2 13h3" />
  </Icon>
)

// Getting around
export const SneakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 16.5V10l3.5-3 2.5 3.5 4 1.5 6.5 1.8a2.4 2.4 0 0 1 1.5 2.2v.5Z" />
    <path d="M3 19.5h18" />
    <path d="M9.5 11.2l1-1.2M12 12.3l1-1.3" />
  </Icon>
)

export const CaneIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="4.2" r="1.7" />
    <path d="M10 7v6l-2.5 7M10 13l2.5 7" />
    <path d="M10 9l3.5 2.5" />
    <path d="M17 20V9.5a2 2 0 0 0-3.5-1.3" />
  </Icon>
)

export const CrutchesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3.5 10 20.5M16.5 3.5 14 20.5" />
    <path d="M6 3.5h3M15 3.5h3" />
    <path d="M8.3 10.5h2.4M13.3 10.5h2.4" />
  </Icon>
)

export const WheelchairIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="3.8" r="1.7" />
    <path d="M10 6.5v6.5h5.5l2 5.5" />
    <path d="M10 9.5h5" />
    <path d="M7 11.5a5.2 5.2 0 1 0 7 6.2" />
  </Icon>
)

export const StrollerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11h13a6 6 0 0 1-6 6H9a5 5 0 0 1-5-5Z" />
    <path d="M11 11V4a7 7 0 0 1 6.5 7" />
    <path d="M17 11l2-5h2" />
    <circle cx="8" cy="19.5" r="1.5" />
    <circle cx="15" cy="19.5" r="1.5" />
  </Icon>
)

// General
export const CarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15.5V13l2-4.5a2 2 0 0 1 1.8-1.2h9.4a2 2 0 0 1 1.8 1.2l2 4.5v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
    <path d="M5 12.5h14" />
    <circle cx="7.5" cy="16.8" r="1.6" />
    <circle cx="16.5" cy="16.8" r="1.6" />
  </Icon>
)

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const DoorIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
    <path d="M4 20.5h16" />
    <circle cx="14.5" cy="12.5" r="0.6" fill="currentColor" />
  </Icon>
)

export const SpeakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5.5v13l10.5-6.5Z" />
  </Icon>
)

export const LocateIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </Icon>
)

export const PersonIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Icon>
)

export const MapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5Z" />
    <path d="M9 4.5v12.7M15 6.8v12.7" />
  </Icon>
)

// AI curb check, weather and slope
export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
    <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.4 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.5M12 17.2v.1" />
  </Icon>
)

export const RainIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 15.5a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17 7.5a4 4 0 0 1 .5 8H7Z" />
    <path d="M8.5 18.5 7.5 21M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" />
  </Icon>
)

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
)

export const SlopeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 19.5h18L3 11.5v8Z" />
    <path d="M14 19.5a3.5 3.5 0 0 0-.9-2.5" />
  </Icon>
)
