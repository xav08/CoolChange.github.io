import { useEffect, useState } from "react";

type Page = "story" | "map" | "about";

// convert supported url hashes into page names
function pageFromHash(): Page {
  if (window.location.hash === "#about") return "about";
  if (window.location.hash === "#map") return "map";
  return "story";
}

// return the page selected by the url hash
export function useCurrentPage() {
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    // update state after browser navigation
    function updatePage() {
      setPage(pageFromHash());
    }

    // keep the visible page aligned with the url hash
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return page;
}
