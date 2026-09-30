const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp'); const fa = require('react-icons/fa6');
const want = { bullseye: 'FaBullseye', zoom: 'FaMagnifyingGlassPlus', bulb: 'FaLightbulb', road: 'FaRoad', youtube: 'FaYoutube',
  github: 'FaGithub', book: 'FaBook', link: 'FaLink', rocket: 'FaRocket', server: 'FaServer', db: 'FaDatabase', upload: 'FaUpload',
  download: 'FaDownload', eye: 'FaEye', sliders: 'FaSliders', clock: 'FaClock', gears: 'FaGears', scale: 'FaScaleBalanced',
  water: 'FaWater', tree: 'FaTree', crosshairs: 'FaCrosshairs', wave: 'FaWaveSquare', filter: 'FaFilter', cloud: 'FaCloud',
  flask: 'FaFlask', code: 'FaCode', search: 'FaMagnifyingGlass', lock2: 'FaUserShield', plane: 'FaJetFighter', mountain: 'FaMountain' };
(async () => {
  for (const [k, n] of Object.entries(want)) {
    if (!fa[n]) { console.log('missing', n); continue; }
    const svg = renderToStaticMarkup(React.createElement(fa[n], { size: 256, color: '#FFFFFF' }));
    await sharp(Buffer.from(svg)).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`assets/icons/${k}.png`);
  }
  console.log('done');
})();
