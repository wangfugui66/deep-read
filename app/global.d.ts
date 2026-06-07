/** FluxRead — global TypeScript declarations for Web Components. */

declare namespace JSX {
  interface IntrinsicElements {
    /** @hyperframes/player — Web Component for playing HyperFrames HTML animations */
    'hyperframes-player': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string;
        html?: string;
        autoplay?: boolean;
        loop?: boolean;
        controls?: boolean;
      },
      HTMLElement
    >;
  }
}
