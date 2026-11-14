// Decorative SVG primitives shared by Discord's rasterized cards. They carry no data or controls.
function brandMark666(x, y, size = 52) {
    return `<g transform="translate(${x} ${y}) scale(${size / 52})"><circle cx="26" cy="26" r="25" fill="#090709" stroke="#49202F"/><path d="M17 12l4 3 5-7 5 7 4-3-2 7H19z" fill="#B91F3B"/><text x="26" y="39" text-anchor="middle" fill="#E53955" font-family="Inter, DejaVu Sans, sans-serif" font-size="22" font-weight="bold" font-style="italic" letter-spacing="-2">666</text><path d="M39 35v8m0-8 5-1v7" stroke="#E53955" stroke-width="1.5"/><circle cx="37" cy="44" r="2" fill="#E53955"/><circle cx="42" cy="42" r="2" fill="#E53955"/></g>`;
}

function ambientDetails666(width, height) {
    return `<g opacity=".5"><path d="M0 43L43 0H105L0 105Z" fill="#B91F3B" opacity=".5"/><path d="M0 67L67 0H74L0 74Z" fill="#FF4568" opacity=".4"/><path d="M${width - 145} ${height}L${width} ${height - 145}V${height - 97}L${width - 97} ${height}Z" fill="#B91F3B" opacity=".28"/><path d="M${width - 119} ${height}L${width} ${height - 119}M${width - 96} ${height}L${width} ${height - 96}" stroke="#FF4568" opacity=".22" stroke-width="2"/><path d="M${width - 330} ${height} Q${width - 270} ${height - 45} ${width - 210} ${height - 14} T${width - 70} ${height - 28} L${width} ${height - 70}V${height}Z" fill="#B91F3B" opacity=".10"/></g>`;
}

function waveform666(x, y, opacity = 0.35) {
    const heights = [8, 15, 24, 39, 27, 52, 36, 66, 42, 57, 29, 19, 11];
    return `<g transform="translate(${x} ${y})" fill="#E53955" opacity="${opacity}">${heights.map((h, i) => `<rect x="${i * 8}" y="${(66 - h) / 2}" width="4" height="${h}" rx="2"/>`).join("")}</g>`;
}

function musicDecoration666(kind) {
    if (kind === "joined") {
        return `<g transform="translate(720 145) rotate(-12)" fill="#B91F3B" opacity=".18"><path d="M51 0v85c0 12-11 20-23 20-11 0-17-7-14-16 3-9 14-14 25-13V15l61-15v70c0 12-11 20-23 20-11 0-17-7-14-16 3-9 14-14 25-13V-9z"/></g>`;
    }
    return `<g transform="translate(718 125)" fill="none" stroke="#B91F3B" stroke-width="9" opacity=".2"><path d="M15 85V63a70 70 0 0 1 140 0v22"/><rect x="4" y="72" width="30" height="72" rx="14" fill="#150D13"/><rect x="136" y="72" width="30" height="72" rx="14" fill="#150D13"/></g>`;
}

function artworkBadge666(x, y) {
    return `<g transform="translate(${x} ${y})"><circle cx="18" cy="18" r="18" fill="#080709" fill-opacity=".82"/><path d="M17 21V8l10-2v13" fill="none" stroke="#F5EDF0" stroke-width="2"/><ellipse cx="14" cy="22" rx="3.5" ry="2.5" fill="#F5EDF0"/><ellipse cx="24" cy="20" rx="3.5" ry="2.5" fill="#F5EDF0"/></g>`;
}

function voiceDetailIcon666(kind, x, y) {
    const shapes = {
        user: '<circle cx="9" cy="6" r="4"/><path d="M2 18c0-4 3-7 7-7s7 3 7 7z"/>',
        voice: '<path d="M2 6h4l5-4v14l-5-4H2z"/><path d="M13 5c3 2 3 6 0 8" fill="none" stroke="#B9AAB1" stroke-width="1.5"/>',
        clock: '<circle cx="9" cy="9" r="8"/><path d="M9 4v5l4 2" fill="none" stroke="#150D13" stroke-width="1.5"/>',
        date: '<rect x="1" y="3" width="16" height="14" rx="2"/><path d="M1 7h16M5 1v5M13 1v5" fill="none" stroke="#150D13" stroke-width="1.5"/>',
    };
    return `<g transform="translate(${x} ${y})" fill="#B9AAB1" opacity=".85">${shapes[kind] || ""}</g>`;
}

module.exports = { brandMark666, ambientDetails666, waveform666, musicDecoration666, voiceDetailIcon666, artworkBadge666 };
