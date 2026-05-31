import React, { useEffect, useRef, useState } from "react";

/**
 * Renders a min-height placeholder until it scrolls within `rootMargin` of the
 * viewport, then latches to rendering `children` (and never reverts) so the
 * panel's lazy chunk only loads on approach and stays mounted thereafter.
 */
export default function LazyOnVisible({
  children,
  minHeight = 220,
  rootMargin = "400px",
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  if (shown) return children;
  return <div ref={ref} aria-hidden="true" style={{ minHeight }} />;
}
