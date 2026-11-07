// ACED Social — local leaderboard + share card generator
// v7.1: share card rebuilt to the CRT "terminal" brand; now carries
// readiness, ante reached, and a calibration grade.
(function () {
  const LB_KEY = 'aced_leaderboard';
  const MAX_ENTRIES = 10;
  const mem = {};
  function lsGet(k) { try { return window["local" + "Storage"].getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } }
  function lsSet(k, v) { try { window["local" + "Storage"].setItem(k, v); } catch (e) { mem[k] = v; } }

  function load() { try { return JSON.parse(lsGet(LB_KEY)) || []; } catch (e) { return []; } }
  function save(d) { try { lsSet(LB_KEY, JSON.stringify(d)); } catch (e) {} }

  function recordRun({ score, section, ante, streak, bossesDefeated }) {
    const lb = load();
    lb.push({ score, section: section || 'ACED', ante, streak, bossesDefeated, date: new Date().toISOString().slice(0, 10) });
    lb.sort((a, b) => b.score - a.score);
    save(lb.slice(0, MAX_ENTRIES));
  }
  function getLeaderboard() { return load(); }

  // rank from readiness (matches the run-summary copy)
  function rankFor(r) { if(typeof r!=='number'||!Number.isFinite(r))return 'UNRANKED'; if (r >= 90) return 'LEGEND'; if (r >= 80) return 'MASTER'; if (r >= 65) return 'ADEPT'; if (r >= 50) return 'SCHOLAR'; if (r >= 30) return 'APPRENTICE'; return 'ROOKIE'; }

  // Generate share-card data URL via canvas — CRT terminal styling.
  function generateShareCard(opts) {
    opts = opts || {};
    const score = opts.score || 0, streak = opts.streak || 0, section = opts.section || 'ACED';
    const bosses = opts.bossesDefeated || 0;
    const data=Object.getOwnPropertyDescriptor(opts,'readiness');
    const readiness=data&&Object.prototype.hasOwnProperty.call(data,'value')&&typeof data.value==='number'&&Number.isFinite(data.value)?
      Math.max(0,Math.min(100,Math.round(data.value))):null;
    const fy = opts.fyReached || 1, calib = opts.calib || null, rank = readiness===null?'UNRANKED':opts.rank||rankFor(readiness);

    const W = 1200, H = 630, P = 64;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const PHOS = '#4dff9e', DIM = '#1f6b45', AMBER = '#ffb454', MONEY = '#9be36b', ASH = '#6f8a78', ASHD = '#43574a', CELL = '#0d1f15';
    const MONO = s => s + 'px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
    const glow = (col, b) => { x.shadowColor = col; x.shadowBlur = b || 0; };

    // background + vignette
    x.fillStyle = '#070b08'; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(W / 2, -80, 80, W / 2, H / 2, H);
    g.addColorStop(0, '#0c1a12'); g.addColorStop(1, '#070b08'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // frame
    x.strokeStyle = 'rgba(77,255,158,.22)'; x.lineWidth = 2; x.strokeRect(36, 36, W - 72, H - 72);

    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    // header
    x.fillStyle = PHOS; glow(PHOS, 16); x.font = '800 ' + MONO(50); x.fillText('ACED_', P, 118); glow(PHOS, 0);
    x.fillStyle = ASH; x.font = MONO(22); x.fillText('// ' + section + ' \u00b7 study roguelike', P, 150);
    // rank chip (top-right)
    x.textAlign = 'right';
    x.fillStyle = ASHD; x.font = MONO(16); x.fillText('GAME RANK', W - P, 104);
    x.fillStyle = AMBER; glow(AMBER, 14); x.font = '800 ' + MONO(34); x.fillText(rank, W - P, 142); glow(AMBER, 0);
    x.textAlign = 'left';
    // divider
    x.strokeStyle = 'rgba(77,255,158,.16)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(P, 180); x.lineTo(W - P, 180); x.stroke();
    x.strokeStyle = PHOS; glow(PHOS, 8); x.beginPath(); x.moveTo(P, 180); x.lineTo(P + 56, 180); x.stroke(); glow(PHOS, 0);

    // SCORE (left)
    x.fillStyle = ASHD; x.font = MONO(20); x.fillText('RUN SCORE', P, 236);
    x.fillStyle = MONEY; glow(MONEY, 22); x.font = '800 ' + MONO(116); x.fillText(score.toLocaleString(), P, 348); glow(MONEY, 0);

    // READINESS (right)
    const RX = 660;
    x.fillStyle = ASHD; x.font = MONO(20); x.fillText('GAME PROGRESS', RX, 236);
    if(readiness===null){
      x.fillStyle=ASH;x.font=MONO(20);x.fillText('Game progress not available.',RX,300);
    }else{
    x.fillStyle = PHOS; glow(PHOS, 20); x.font = '800 ' + MONO(92); x.fillText(readiness + '', RX, 330);
    const nW = x.measureText(readiness + '').width;
    x.fillStyle = DIM; x.font = '800 ' + MONO(38); x.fillText('%', RX + nW + 8, 330); glow(PHOS, 0);
    // readiness bar
    const bw = W - P - RX, bh = 20, segs = 16, gap = 4, sw = (bw - (segs - 1) * gap) / segs, on = Math.round(readiness / 100 * segs), by = 360;
    for (let i = 0; i < segs; i++) { x.fillStyle = i < on ? PHOS : CELL; x.fillRect(RX + i * (sw + gap), by, sw, bh); }
    }

    x.fillStyle=ASH;x.font=MONO(14);
    x.fillText('Game progress increases through cards, answers and game rewards.',P,408);
    x.fillText('It is not a measure of recall or a prediction of test performance.',P,430);
    // stats strip
    const sy = 470;
    const cells = [['ANTE', 'A' + fy, PHOS], ['STREAK', String(streak || 0), AMBER], ['CONFIDENCE BETS', calib ? ('GRADE ' + calib+(Number.isInteger(opts.calibCount)&&opts.calibCount>0?' · N='+opts.calibCount:'')) : '\u2014', AMBER], ['BOSSES CLEARED', String(bosses || 0), PHOS]];
    const cw = (W - 2 * P) / 4;
    for (let k = 0; k < cells.length; k++) {
      const cx = P + k * cw;
      x.fillStyle = ASHD; x.font = MONO(15); x.fillText(cells[k][0], cx, sy);
      x.fillStyle = cells[k][2]; x.font = '800 ' + MONO(30); x.fillText(cells[k][1], cx, sy + 38);
    }

    // footer
    x.strokeStyle = 'rgba(77,255,158,.16)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(P, 520); x.lineTo(W - P, 520); x.stroke();
    x.fillStyle = PHOS; x.font = MONO(22); x.fillText('acedhq.com', P, 562);
    x.textAlign = 'right'; x.fillStyle = ASHD; x.font = MONO(18); x.fillText('study anything like a roguelike', W - P, 562); x.textAlign = 'left';
    if(calib){
      x.fillStyle=ASH;x.font=MONO(12);
      x.fillText('From the currently available confidence-bet history for this pack, up to the latest 400 records.',P,586);
      x.fillText('This does not include every practice route or prove unaided recall.',P,606);
    }

    // scanlines
    x.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 0; y < H; y += 3) { x.fillRect(0, y, W, 1); }
    return c.toDataURL('image/png');
  }

  function downloadCard(dataURL, filename = 'aced-score.png') {
    const a = document.createElement('a');
    a.href = dataURL; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function copyCardToClipboard(dataURL) {
    try {
      const blob = await (await fetch(dataURL)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) { return false; }
  }

  window.ACEDSocial = { recordRun, getLeaderboard, generateShareCard, downloadCard, copyCardToClipboard, rankFor };
})();
