/** Vite's `?url` suffix; used to hand pdf.js the URL of its own worker chunk. */
declare module '*?url' {
  const src: string;
  export default src;
}
