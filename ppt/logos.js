const s = require('simple-icons'); const sharp = require('sharp');
const want = ['python','pytorch','onnx','threedotjs','leaflet','fastapi','docker','githubpages','github','javascript','webassembly','webgpu','numpy','openstreetmap','osgeo','youtube','googlecolab','kaggle','qgis'];
(async () => {
  for (const w of want) {
    const ic = s['si' + w.charAt(0).toUpperCase() + w.slice(1)];
    const svg = ic.svg.replace('<svg ', `<svg fill="#${ic.hex}" `);
    await sharp(Buffer.from(svg), { density: 600 }).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`../docs/deck/img/logo_${w}.png`);
  }
  console.log('logos done');
})();
