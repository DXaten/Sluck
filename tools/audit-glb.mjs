// Quick geometry and payload audit for candidate enemy models.
// Usage: node tools/audit-glb.mjs [--triangles 3000] path/to/model.glb [...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

function readGlb(file) {
  const data = readFileSync(file);
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2) {
    throw new Error('not a GLB 2.0 file');
  }
  if (data.readUInt32LE(8) !== data.length) throw new Error('invalid GLB length');
  const jsonLength = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > data.length) {
    throw new Error('missing or invalid JSON chunk');
  }
  const binHeader = 20 + jsonLength;
  const binOffset = binHeader + 8 <= data.length && data.readUInt32LE(binHeader + 4) === 0x004e4942
    ? binHeader + 8 : null;
  return { data, binOffset, gltf: JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) };
}

function imageSize(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.toString('ascii', 12, 16) === 'VP8X') {
    const width = 1 + bytes.readUIntLE(24, 3), height = 1 + bytes.readUIntLE(27, 3);
    return [width, height];
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let pos = 2; pos + 8 < bytes.length;) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xff || marker === 0x00) { pos++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [bytes.readUInt16BE(pos + 7), bytes.readUInt16BE(pos + 5)];
      }
      pos += 2 + bytes.readUInt16BE(pos + 2);
    }
  }
  return null;
}

function triangleCount(mode, count) {
  if (mode === undefined || mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function audit(file, triangleBudget) {
  const { data, binOffset, gltf } = readGlb(file);
  let triangles = 0;
  let vertices = 0;
  let draws = 0;
  const modes = new Set();
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const vertexAccessor = gltf.accessors?.[primitive.attributes?.POSITION];
      const indexAccessor = gltf.accessors?.[primitive.indices];
      const count = indexAccessor?.count ?? vertexAccessor?.count ?? 0;
      vertices += vertexAccessor?.count ?? 0;
      triangles += triangleCount(primitive.mode, count);
      draws++;
      if (primitive.mode !== undefined && ![4, 5, 6].includes(primitive.mode)) modes.add(primitive.mode);
    }
  }
  const sizeMiB = data.length / 1048576;
  const warnings = [];
  if (triangles > triangleBudget) warnings.push(`over the ${triangleBudget} triangle game target`);
  if (draws > 2) warnings.push('more than 2 mesh primitives / draw calls');
  if (sizeMiB > 4) warnings.push('over 4 MiB on disk');
  if (modes.size) warnings.push(`non-triangle primitive modes: ${[...modes].join(', ')}`);
  if (!gltf.meshes?.length) warnings.push('no meshes');
  console.log(`${basename(file)}: ${triangles.toLocaleString()} triangles, ${vertices.toLocaleString()} vertices, ${draws} primitives, ${sizeMiB.toFixed(2)} MiB`);
  console.log(`  ${gltf.materials?.length ?? 0} materials, ${gltf.textures?.length ?? 0} textures, ${gltf.images?.length ?? 0} images, ${gltf.animations?.length ?? 0} animations`);
  for (const [index, image] of (gltf.images ?? []).entries()) {
    const view = gltf.bufferViews?.[image.bufferView];
    const bytes = binOffset !== null && view && (view.buffer ?? 0) === 0
      ? data.subarray(binOffset + (view.byteOffset ?? 0), binOffset + (view.byteOffset ?? 0) + view.byteLength)
      : null;
    const dimensions = bytes && imageSize(bytes);
    console.log(`  image ${index + 1}: ${dimensions ? dimensions.join('×') : 'unknown size'} ${image.mimeType ?? ''}`.trimEnd());
    if (dimensions && Math.max(...dimensions) > 1024) warnings.push(`image ${index + 1} exceeds the 1K mobile texture target`);
  }
  for (const warning of warnings) console.log(`  REVIEW: ${warning}`);
  return warnings.length ? 1 : 0;
}

let args = process.argv.slice(2);
let triangleBudget = 3000;
if (args[0] === '--triangles') {
  triangleBudget = Number(args[1]);
  args = args.slice(2);
}
if (!args.length || !Number.isInteger(triangleBudget) || triangleBudget < 1) {
  console.error('Usage: node tools/audit-glb.mjs [--triangles 3000] model.glb [...]');
  process.exit(2);
}

let failures = 0;
for (const file of args) {
  try { failures += audit(file, triangleBudget); }
  catch (error) { console.error(`${basename(file)}: ${error.message}`); failures++; }
}
process.exitCode = failures ? 1 : 0;
