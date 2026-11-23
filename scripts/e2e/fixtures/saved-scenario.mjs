export function readSavedScenario(page) {
  return page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return JSON.parse(localStorage.getItem('friis-rf-planner-v3-state'));
  });
}
