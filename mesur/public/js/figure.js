// Minimal line figure with one highlight zone per measurement.

const ZONES = {
  height: '<path d="M178 22V452M172 22h12M172 452h12"/>',
  neck: '<ellipse class="fill" cx="100" cy="80" rx="13" ry="5"/><ellipse cx="100" cy="80" rx="13" ry="5"/>',
  shoulder: '<path d="M58 97H142M58 91v12M142 91v12"/>',
  chest: '<ellipse class="fill" cx="100" cy="132" rx="37" ry="8"/><ellipse cx="100" cy="132" rx="37" ry="8"/>',
  waist: '<ellipse class="fill" cx="100" cy="192" rx="29" ry="7"/><ellipse cx="100" cy="192" rx="29" ry="7"/>',
  hip: '<ellipse class="fill" cx="100" cy="238" rx="36" ry="8"/><ellipse cx="100" cy="238" rx="36" ry="8"/>',
  arm: '<path d="M143 100L160 262M137 100h12M154 262h12"/>',
  thigh: '<ellipse class="fill" cx="118" cy="286" rx="16" ry="5.5"/><ellipse cx="118" cy="286" rx="16" ry="5.5"/>',
  inseam: '<path d="M104 262L112 448M98 262h12M106 448h12"/>',
};

/**
 * @param {object} opts
 * @param {string[]} [opts.show]  zones drawn faintly all the time
 * @param {string|null} [opts.active] zone drawn at full strength
 */
export function figureSvg({ show = [], active = null } = {}) {
  const zones = Object.entries(ZONES).map(([key, d]) => {
    const cls = key === active ? 'on' : show.includes(key) ? 'on dim' : '';
    return `<g class="zone ${cls}" data-zone="${key}">${d}</g>`;
  }).join('');
  return `
  <svg class="figure" viewBox="0 0 200 474" role="img" aria-label="Body outline showing where each measurement is taken">
    <g class="body">
      <circle cx="100" cy="46" r="24"/>
      <path d="M91 69v10q-14 9-33 16M109 69v10q14 9 33 16"/>
      <path d="M58 95q-14 6-16 26l-8 138q0 8 6 8t7-8l11-112"/>
      <path d="M142 95q14 6 16 26l8 138q0 8-6 8t-7-8l-11-112"/>
      <path d="M58 147q4 28 13 45q-8 22-8 48l6 104l6 104q1 6 8 6h6q7 0 7-6l2-186h4l2 186q0 6 7 6h6q7 0 8-6l6-104l6-104q0-26-8-48q9-17 13-45"/>
    </g>
    ${zones}
  </svg>`;
}

/** Switch the highlighted zone on an already-rendered figure. */
export function setActiveZone(root, key, show = []) {
  root.querySelectorAll('.zone').forEach((g) => {
    const k = g.dataset.zone;
    g.setAttribute('class', `zone ${k === key ? 'on' : show.includes(k) ? 'on dim' : ''}`);
  });
}

/** Flat T-shirt drawing for the simulated product page. */
export const teeSvg = `
  <svg viewBox="0 0 300 300" fill="none" stroke="#5a5a5a" stroke-width="1.3" stroke-linejoin="round" role="img" aria-label="T-shirt illustration">
    <path d="M110 40q40 26 80 0l62 30l-26 54l-30-12v148H104V112l-30 12l-26-54z" fill="#151515"/>
    <path d="M110 40q40 40 80 0" />
  </svg>`;
