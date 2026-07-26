(() => {
  const links = [...document.querySelectorAll("[data-guide-link]")];
  const panels = [...document.querySelectorAll("[data-guide-panel]")];
  const nextButton = document.querySelector("[data-guide-next]");
  const keys = links.map((link) => link.dataset.guideLink);

  function showGuide(key, updateHistory = false) {
    const selected = keys.includes(key) ? key : keys[0];

    links.forEach((link) => {
      const active = link.dataset.guideLink === selected;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.guidePanel !== selected;
    });

    if (updateHistory) history.replaceState(null, "", `#${selected}`);

    const currentIndex = keys.indexOf(selected);
    if (nextButton) {
      const last = currentIndex === keys.length - 1;
      nextButton.dataset.nextGuide = last ? keys[0] : keys[currentIndex + 1];
      nextButton.querySelector("b").textContent = last ? "↺" : "→";
    }
  }

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showGuide(link.dataset.guideLink, true);
      if (window.innerWidth < 900) {
        document.querySelector(".academy-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  nextButton?.addEventListener("click", () => {
    showGuide(nextButton.dataset.nextGuide, true);
    document.querySelector(".academy-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("hashchange", () => showGuide(location.hash.slice(1)));
  showGuide(location.hash.slice(1));
})();
