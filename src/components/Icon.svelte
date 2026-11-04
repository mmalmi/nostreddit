<script lang="ts">
  export let name: string;
  export let size = 18;
  const paths: Record<string, string> = {
    bell: 'M3 17h18l-2-3v-4a7 7 0 0 0-14 0v4z M10 20a2 2 0 0 0 4 0',
    home: 'M3 11 12 3l9 8v9h-6v-6H9v6H3z',
    users:
      'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 4a4 4 0 0 1 0 7 M19 15a4 4 0 0 1 3 4v2',
    save: 'M6 4h12v17l-6-4-6 4z',
    compass: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M16.5 7.5l-3 6-6 3 3-6z',
    search: 'M16.5 16.5 21 21 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    plus: 'M12 5v14 M5 12h14',
    hot: 'M13 2c1 6-5 6-3 12 2 0 4-2 5-5 3 3 5 5 5 8a8 8 0 1 1-16 0c0-4 2-7 5-10-1 3-1 4 0 5 0-4 5-5 4-10z',
    clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2',
    top: 'M4 19h16 M5 15v-3 M11 15V7 M17 15V3',
    arrow: 'M12 4l-8 8h5v8h6v-8h5z',
    comment: 'M21 11a9 8 0 0 1-9 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 8 0 0 1 18 0z',
    zap: 'm13 2-9 12h7l-1 8 10-13h-7z',
    share: 'M13 6l5-4 5 4 M18 3v11 M13 8H5v13h15v-5',
    link: 'M10 13a4 4 0 0 0 6 .5l4-4a4 4 0 0 0-6-6l-2 2 M14 11a4 4 0 0 0-6-.5l-4 4a4 4 0 0 0 6 6l2-2',
    external: 'M13 4h7v7 M20 4l-11 11 M9 5H4v15h15v-5',
    settings: 'M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2 M11 3v6 M7 9v6 M15 15v6',
    menu: 'M3 6h18 M3 12h18 M3 18h18',
    close: 'M5 5l14 14 M19 5 5 19',
    next: 'm9 5 7 7-7 7',
    back: 'm15 5-7 7 7 7',
    down: 'm6 9 6 6 6-6',
    check: 'm4 12 5 5L20 6',
    edit: 'M4 20l5-1L21 7l-4-4L5 15z M14 6l4 4',
    user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
    wave: 'M2 13h4l3-8 5 15 3-9h5',
    key: 'M15 11a5 5 0 1 1 6-5 5 5 0 0 1-6 5l-4 4H8v3H5v3H2v-4z',
    logout: 'M10 4H4v16h6 M10 12h12 M18 8l4 4-4 4',
    hash: 'M5 9h15 M4 15h15 M10 3 7 21 M17 3l-3 18',
    bitcoin:
      'M8 5v14 M5 5h10c6 0 6 7 0 7H8 M9 12h7c6 0 5 7-1 7H5 M10 2v3 M14 2v3 M10 19v3 M14 19v3',
    camera: 'M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    music:
      'M8 17V5l12-2v12 M8 17a3 2 0 1 1-6 0 3 2 0 0 1 6 0 M20 15a3 2 0 1 1-6 0 3 2 0 0 1 6 0',
    art: 'M12 3a9 9 0 1 0 0 18c4 0 3-3 2-4s-1-3 2-3h2c6 0 4-11-6-11z M7 10h.1 M10 7h.1 M15 7h.1 M17 10h.1',
    tech: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
    nostr:
      'M3 15a15 15 0 0 1 18 0 M6 11a12 12 0 0 1 12 0 M9 7a7 7 0 0 1 6 0 M11 19h2',
    globe:
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c-6 5-6 15 0 20 6-5 6-15 0-20',
    book: 'M2 4c4-1 7 0 10 2 3-2 6-3 10-2v15c-4-1-7 0-10 2-3-2-6-3-10-2z M12 6v15',
    lock: 'M5 10h14v11H5z M8 10V7a4 4 0 1 1 8 0v3',
    eye: 'M2 12c5-9 15-9 20 0-5 9-15 9-20 0z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    image: 'M3 4h18v16H3z M3 17l5-5 4 3 4-6 5 7 M8 8h.1',
    logout2: 'M13 6l6 6-6 6 M6 12h13',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] ?? paths.hash} /></svg
>
