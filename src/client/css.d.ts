/** Ambient type for CSS Modules imports compiled by the tsdown lightningcss plugin. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
