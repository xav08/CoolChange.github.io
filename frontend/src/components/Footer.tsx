import projectPreview from "../assets/project_preview.png";

// show the closing project artwork
export function ClosingImage() {
  return <section className="closing"><img className="closing-image" src={projectPreview} alt="Cool Change: See the heat. Change the street." /></section>;
}

// show the site purpose in the footer
export function Footer() {
  return (
    <footer>
      <div className="footer-brand"><span className="wordmark-dot" />Cool Change</div>
      <div><strong>Purpose</strong><p>SDG 11 · Sustainable cities and communities</p></div>
    </footer>
  );
}
