const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp'); const fa = require('react-icons/fa6');
const want = { shield: 'FaShieldHalved', flood: 'FaHouseFloodWater', wheat: 'FaWheatAwn', city: 'FaCity', grad: 'FaGraduationCap',
  people: 'FaPeopleGroup', rupee: 'FaIndianRupeeSign', leaf: 'FaLeaf', flag: 'FaLock',
  brain: 'FaBrain', sat: 'FaSatellite', globe: 'FaGlobe', laptop: 'FaLaptop',
  dish: 'FaSatelliteDish', layers: 'FaLayerGroup', chip: 'FaMicrochip', chart: 'FaChartArea', file: 'FaFileExport',
  bolt: 'FaBolt', check: 'FaCircleCheck', warn: 'FaTriangleExclamation', arrow: 'FaArrowRight' };
(async () => {
  for (const [k, n] of Object.entries(want)) {
    if (!fa[n]) { console.log('missing', n); continue; }
    const svg = renderToStaticMarkup(React.createElement(fa[n], { size: 256, color: '#FFFFFF' }));
    await sharp(Buffer.from(svg)).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`assets/icons/${k}.png`);
  }
  console.log('done');
})();
