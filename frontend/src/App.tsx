import { lazy, Suspense } from "react";
import { AboutPage } from "./components/AboutPage";
import { Header } from "./components/Header";
import { StoryPage } from "./components/StoryPage";
import { useCurrentPage } from "./hooks/useCurrentPage";
import { PasswordGate } from "./components/PasswordGate";

// The story does not need to download Mapbox until the visitor opens the map.
const MelbourneMapPage = lazy(() => import("./components/MelbourneMapPage").then(module => ({ default: module.MelbourneMapPage })));

// choose the page that matches the current url hash
export default function App() {
  const page = useCurrentPage();

  return (
    <>
      <PasswordGate>
        <Header page={page} />
        <Suspense fallback={<main role="status" style={{ padding: "160px 8vw", minHeight: "100svh" }}>Loading your map…</main>}>
          {page === "about" ? <AboutPage /> : page === "map" ? <MelbourneMapPage /> : <StoryPage />}
        </Suspense>
      </PasswordGate>
    </>
  );
}
