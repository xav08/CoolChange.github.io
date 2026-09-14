import { AboutPage } from "./components/AboutPage";
import { Header } from "./components/Header";
import { StoryPage } from "./components/StoryPage";
import { MelbourneMapPage } from "./components/MelbourneMapPage";
import { useCurrentPage } from "./hooks/useCurrentPage";
import { PasswordGate } from "./components/PasswordGate";

// choose the page that matches the current url hash
export default function App() {
  const page = useCurrentPage();

  return (
    <>
      <PasswordGate>
        <Header />
        {page === "about" ? <AboutPage /> : page === "map" ? <MelbourneMapPage /> : <StoryPage />}
      </PasswordGate>
    </>
  );
}