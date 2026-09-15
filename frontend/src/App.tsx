import { AboutPage } from "./components/AboutPage";
import { Header } from "./components/Header";
import { StoryPage } from "./components/StoryPage";
import { MelbourneMapPage } from "./components/MelbourneMapPage";
import { useCurrentPage } from "./hooks/useCurrentPage";

// choose the page that matches the current url hash
export default function App() {
  const page = useCurrentPage();

  return (
    <>
      <Header />
      {page === "about" ? <AboutPage /> : page === "map" ? <MelbourneMapPage /> : <StoryPage />}
    </>
  );
}
