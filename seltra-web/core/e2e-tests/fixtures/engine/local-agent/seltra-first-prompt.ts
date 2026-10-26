import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a minimal responsive Volta Gold landing page for web E2E",
  turns: [
    {
      text: "I'll build the Volta Gold landing page.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/App.tsx",
            description: "Build the Volta Gold coffee landing page",
            content: `import "./App.css";

const products = ["Sunrise Blend", "Highland Roast", "Cocoa Mocha"];

export default function App() {
  return (
    <main>
      <nav><a href="#home">Volta Gold</a><div><a href="#coffee">Coffee</a><a href="#story">Our story</a></div></nav>
      <section className="hero" id="home">
        <p>GROWN IN GHANA · ROASTED WITH CARE</p>
        <h1>A brighter kind of coffee.</h1>
        <p>Meet the rich, sun-grown flavors of Volta Gold.</p>
        <a className="button" href="#coffee">Explore our coffee</a>
      </section>
      <section className="coffee" id="coffee">
        <h2>Find your favorite</h2>
        <div className="products">{products.map((product) => <article key={product}><span>VOLTA GOLD</span><h3>{product}</h3><p>Thoughtfully sourced in Ghana and roasted for a smooth, memorable cup.</p></article>)}</div>
      </section>
      <footer id="story">Good coffee, grown together. · Made in Ghana</footer>
    </main>
  );
}
`,
          },
        },
        {
          name: "write_file",
          args: {
            path: "src/App.css",
            description: "Style the responsive Volta Gold landing page",
            content: `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #272417; background: #fffdf5; }
* { box-sizing: border-box; }
body { margin: 0; }
nav { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 7vw; background: #fffdf5; }
nav a { color: inherit; text-decoration: none; font-weight: 700; margin-right: 1rem; }
.hero { min-height: 62vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 3rem 1.5rem; color: #fff9e8; background: linear-gradient(135deg, #5a3318, #a86d22 58%, #d4a43e); }
.hero h1 { max-width: 760px; margin: .4rem 0; font-size: clamp(2.5rem, 7vw, 5rem); line-height: 1.02; }
.button { margin-top: 1rem; padding: .8rem 1.2rem; border-radius: 999px; background: #fff9e8; color: #503214; text-decoration: none; font-weight: 700; }
.coffee { padding: 3rem 7vw; text-align: center; }
.products { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin-top: 1.5rem; text-align: left; }
article { padding: 1.5rem; border: 1px solid #e7dfc7; border-radius: 1rem; background: white; }
article span { color: #987024; font-size: .75rem; letter-spacing: .12em; }
footer { padding: 2rem; text-align: center; background: #302416; color: #fff9e8; }
@media (max-width: 640px) { nav { padding: 1rem; } .products { grid-template-columns: 1fr; } .hero { min-height: 55vh; } }
`,
          },
        },
      ],
    },
    { text: "The responsive Volta Gold landing page is ready." },
  ],
};
