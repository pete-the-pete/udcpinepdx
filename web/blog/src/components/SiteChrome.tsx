/** Header + footer shared across pages. */

export function SiteHeader() {
  return (
    <header class="site">
      <a class="brand" href="#/">udcpinepdx</a>
      <nav>
        <a href="#/">Firings</a>
        <a href="https://github.com/pete-the-pete/udcpinepdx" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return <footer class="site-footer">udcpinepdx · a wood-fired pizza diary · built around the oven</footer>;
}
