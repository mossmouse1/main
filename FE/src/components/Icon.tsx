const PATHS = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13v2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  viewfinder: 'M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4m8 .5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z',
  radar: 'M20.5 8.5a9.2 9.2 0 1 1-5-5m1.7 7.5a5.3 5.3 0 1 1-4.7-4.3M12 12l8-8m-8 8h.01',
  sound: 'M3 9h4l5-4v14l-5-4H3V9Zm12 0a4 4 0 0 1 0 6m2.5-8.5a7.6 7.6 0 0 1 0 11',
  mute: 'M3 9h4l5-4v14l-5-4H3V9Zm12 0 6 6m0-6-6 6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  locate: 'M12 3v3m0 12v3M3 12h3m12 0h3m-9 5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  back: 'M15 5 8 12l7 7',
  check: 'M5 12.5 10 17l9-10',
  close: 'M6 6l12 12M18 6 6 18',
  cloud: 'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9 4.5 4.5 0 0 0 7 18Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  question: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  info: 'M12 11v5m0-8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  image: 'M4 5h16v14H4V5Zm0 11 4-4 4 4 3-3 5 5M15 9h.01',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  shield: 'M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z',
  leaf: 'M20 4C11 4 5 8.5 5 15c0 1.6.4 3 1.1 4.2M20 4c0 9-4.5 15-11 15-1.2 0-2.2-.2-3-.6M20 4 9 15',
  explore: 'M12 12.5s-4.5-3.8-4.5-7a4.5 4.5 0 0 1 9 0c0 3.2-4.5 7-4.5 7Zm0-6.5h.01M4 20.5c2.5 0 3.5-2.5 6.5-2.5s3.5 2.5 6 2.5c1.6 0 2.6-.7 3.5-1.5',
  clipboard: 'M9 3.5h6v3H9v-3Zm0 1.5H6v16h12V5h-3M9 13.5l2 2 4-4',
  walk: 'M13.5 5.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM10 21l2.5-6.5 3 2.5v4M12.5 14.5l1-5.5m0 0-3.5 1.5-1.5 3.5m5-5 2 3.5 3 1',
  binoculars: 'M6.5 19.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10 15.5h4M3.3 14.5 6 5.5h3l1 10M20.7 14.5 18 5.5h-3l-1 10',
  calendar: 'M4 6h16v14H4V6Zm0 4.5h16M8.5 3.5v4m7-4v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01',
  sprout: 'M12 21v-8.5m0 0C12 8.5 9 6 4.5 6c0 4.2 3 6.5 7.5 6.5Zm0-2c0-3.4 2.6-6 7.5-6 0 3.8-3 6-7.5 6Z',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8m0 4.5v-4.5h-4.5',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  bookmark: 'M6.5 3.5h11V21L12 17l-5.5 4V3.5Z',
  plus: 'M12 5v14M5 12h14',
  flip: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm4.6 5.2a3.5 3.5 0 0 1 6.3-1.8M15.4 13.8a3.5 3.5 0 0 1-6.3 1.8M15.2 9.2v2.4h-2.4M8.8 17.8v-2.4h2.4',
  chevron: 'M9 5l7 7-7 7',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
