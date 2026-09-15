import { useEffect, useState } from "react";

type Page = "story" | "map" | "about";

// Convert the URL hash into a page name.
function pageFromHash(): Page {
  if (window.location.hash === "#about") return "about";
  if (window.location.hash === "#map") return "map";
  return "story";
}

// Return the page selected by the URL hash.
export function useCurrentPage() {
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    // Update the page after browser navigation.
    function updatePage() {
      setPage(pageFromHash());
    }

    // keep the visible page aligned with the url hash
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return page;
}
